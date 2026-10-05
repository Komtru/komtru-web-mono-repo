// The claim that stops a second SMS, and the delivery record behind it. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  claimForSend,
  markDeadLettered,
  markFailed,
  markSent,
  releaseStuck,
} from '../../../../src/modules/notify/services/delivery.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertNotification } from '../support.js';

describe.runIf(infraEnabled)('delivery service', () => {
  const t = useTestDatabase();

  const row = async (id: string) => {
    const { rows } = await t.app().query<{
      status: string;
      attempt_count: number;
      provider_reference: string | null;
      failed_reason: string | null;
      sent_at: Date | null;
    }>(
      `SELECT status, attempt_count, provider_reference, failed_reason, sent_at
         FROM notify.notifications WHERE id = $1`,
      [id],
    );
    return rows[0];
  };

  const attempts = async (id: string) => {
    const { rows } = await t
      .app()
      .query<{ attempt_number: number; succeeded: boolean; error_detail: string | null }>(
        `SELECT attempt_number, succeeded, error_detail
           FROM notify.notification_delivery_attempts WHERE notification_id = $1
          ORDER BY attempt_number`,
        [id],
      );
    return rows;
  };

  const outboxTypes = async () => {
    const { rows } = await t
      .app()
      .query<{ event_type: string }>(`SELECT event_type FROM platform.outbox ORDER BY seq`);
    return rows.map((r) => r.event_type);
  };

  it('claims a QUEUED notification once', async () => {
    const id = await insertNotification(t.app(), { channel: 'SMS' });

    expect(await claimForSend(t.db(), id)).toMatchObject({ id, channel: 'SMS', attemptNumber: 1 });
    // A second job for the same row — a redelivery, an operator's retry — finds it already claimed.
    expect(await claimForSend(t.db(), id)).toBeUndefined();
  });

  it('claims again after a failure, with the next attempt number', async () => {
    const id = await insertNotification(t.app(), { status: 'FAILED', attempt_count: 1 });

    expect(await claimForSend(t.db(), id)).toMatchObject({ attemptNumber: 2 });
  });

  it.each(['SENT', 'SUPPRESSED', 'DEAD_LETTERED'])('never claims a %s row', async (status) => {
    const id = await insertNotification(t.app(), {
      status,
      ...(status === 'SUPPRESSED' ? { failed_reason: 'rate_limited' } : {}),
    });

    expect(await claimForSend(t.db(), id)).toBeUndefined();
  });

  it('returns undefined for a notification that does not exist', async () => {
    expect(await claimForSend(t.db(), randomUUID())).toBeUndefined();
  });

  it('carries the rendered message, so the job never re-renders', async () => {
    const id = await insertNotification(t.app(), {
      channel: 'EMAIL',
      rendered_subject: 'Hi',
      rendered_body: 'body',
      recipient_masked: 'a•••@b.com',
    });

    expect(await claimForSend(t.db(), id)).toMatchObject({
      renderedSubject: 'Hi',
      renderedBody: 'body',
      recipientMasked: 'a•••@b.com',
    });
  });

  it('records a successful attempt and publishes notification.sent', async () => {
    const id = await insertNotification(t.app());
    const claimed = await claimForSend(t.db(), id);
    if (!claimed) throw new Error('not claimed');

    await markSent(t.db(), claimed, 'mj-123');

    expect(await row(id)).toMatchObject({ status: 'SENT', provider_reference: 'mj-123' });
    expect((await row(id))?.sent_at).toBeInstanceOf(Date);
    expect(await attempts(id)).toEqual([{ attempt_number: 1, succeeded: true, error_detail: null }]);
    expect(await outboxTypes()).toEqual(['notify.notification.sent']);
  });

  it('records a failed attempt with its reason and publishes notification.failed', async () => {
    const id = await insertNotification(t.app());
    const claimed = await claimForSend(t.db(), id);
    if (!claimed) throw new Error('not claimed');

    await markFailed(t.db(), claimed, 'termii: sms.send failed with status 500');

    expect(await row(id)).toMatchObject({
      status: 'FAILED',
      failed_reason: 'termii: sms.send failed with status 500',
    });
    expect(await attempts(id)).toMatchObject([{ attempt_number: 1, succeeded: false }]);
    expect(await outboxTypes()).toEqual(['notify.notification.failed']);
  });

  it('publishes notification.dead_lettered with the category, so support can open a ticket', async () => {
    const id = await insertNotification(t.app(), { category: 'SECURITY' });
    const claimed = await claimForSend(t.db(), id);
    if (!claimed) throw new Error('not claimed');

    await markDeadLettered(t.db(), claimed, 'gave up after 5 attempts');

    expect(await row(id)).toMatchObject({ status: 'DEAD_LETTERED' });
    expect(await outboxTypes()).toEqual(['notify.notification.dead_lettered']);
    const { rows } = await t
      .app()
      .query<{ payload: { category: string; attempts: number } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'notify.notification.dead_lettered'`,
      );
    expect(rows[0]?.payload).toMatchObject({ category: 'SECURITY', attempts: 1 });
  });

  it('releases a row left SENDING by a killed worker', async () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    const id = await insertNotification(t.app(), {
      status: 'SENDING',
      attempt_count: 1,
      last_attempt_at: stale,
    });

    const released = await releaseStuck(t.db(), new Date(), {
      queuedAfterMs: 120_000,
      sendingAfterMs: 300_000,
    });

    expect(released).toEqual([{ notificationId: id, channel: 'EMAIL' }]);
    expect(await row(id)).toMatchObject({ status: 'FAILED' });
  });

  it('releases a QUEUED row whose enqueue was lost', async () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    const id = await insertNotification(t.app(), { queued_at: stale });

    const released = await releaseStuck(t.db(), new Date(), {
      queuedAfterMs: 120_000,
      sendingAfterMs: 300_000,
    });

    expect(released.map((r) => r.notificationId)).toEqual([id]);
    // Left QUEUED: it was never claimed, so there is no attempt to roll back.
    expect(await row(id)).toMatchObject({ status: 'QUEUED' });
  });

  it('leaves a freshly queued row and a job still running alone', async () => {
    await insertNotification(t.app());
    await insertNotification(t.app(), {
      status: 'SENDING',
      attempt_count: 1,
      last_attempt_at: new Date(),
    });

    await expect(
      releaseStuck(t.db(), new Date(), { queuedAfterMs: 120_000, sendingAfterMs: 300_000 }),
    ).resolves.toEqual([]);
  });

  it('never releases a SUPPRESSED or DEAD_LETTERED row', async () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    await insertNotification(t.app(), {
      status: 'SUPPRESSED',
      failed_reason: 'rate_limited',
      queued_at: stale,
    });
    await insertNotification(t.app(), { status: 'DEAD_LETTERED', queued_at: stale });

    await expect(
      releaseStuck(t.db(), new Date(), { queuedAfterMs: 120_000, sendingAfterMs: 300_000 }),
    ).resolves.toEqual([]);
  });
});
