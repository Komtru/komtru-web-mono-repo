// The claim that stops a second SMS, and the delivery record behind it. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../../src/config/env.js';
import { createLogger } from '../../../../src/platform/logger.js';
import {
  claimForSend,
  notificationExists,
  markDeadLettered,
  markFailed,
  markSent,
  releaseStuck,
} from '../../../../src/modules/notify/services/delivery.service.js';
import { infraEnabled, testRedisUrl } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertNotification } from '../support.js';

const logger = createLogger(
  loadConfig({ LOG_LEVEL: 'silent', POSTGRES_URL: 'postgresql://x@localhost/x', REDIS_URL: testRedisUrl() }),
);

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

    await markSent(t.db(), claimed, 'mj-123', logger);

    expect(await row(id)).toMatchObject({ status: 'SENT', provider_reference: 'mj-123' });
    expect((await row(id))?.sent_at).toBeInstanceOf(Date);
    expect(await attempts(id)).toEqual([{ attempt_number: 1, succeeded: true, error_detail: null }]);
    expect(await outboxTypes()).toEqual(['notify.notification.sent']);
  });

  it('records a failed attempt with its reason and publishes notification.failed', async () => {
    const id = await insertNotification(t.app());
    const claimed = await claimForSend(t.db(), id);
    if (!claimed) throw new Error('not claimed');

    await markFailed(t.db(), claimed, 'termii: sms.send failed with status 500', logger);

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

    await markDeadLettered(t.db(), claimed, 'gave up after 5 attempts', logger);

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
  it('knows a committed row from one that does not exist', async () => {
    const id = await insertNotification(t.app());

    await expect(notificationExists(t.db(), id)).resolves.toBe(true);
    await expect(notificationExists(t.db(), randomUUID())).resolves.toBe(false);
  });

  it('refuses to write back an outcome once the claim was taken over', async () => {
    const id = await insertNotification(t.app());
    const stale = await claimForSend(t.db(), id);
    if (!stale) throw new Error('not claimed');
    // The sweep released it and a second worker claimed and sent it.
    await t.app().query(`UPDATE notify.notifications SET status = 'FAILED' WHERE id = $1`, [id]);
    const fresh = await claimForSend(t.db(), id);
    if (!fresh) throw new Error('not reclaimed');
    await markSent(t.db(), fresh, 'tm-2', logger);

    // The stalled worker finally fails. It must not drag a delivered message back to FAILED.
    await expect(markFailed(t.db(), stale, 'too late', logger)).resolves.toBe(false);

    expect(await row(id)).toMatchObject({ status: 'SENT', provider_reference: 'tm-2' });
    expect(await attempts(id)).toHaveLength(1);
    const { rows } = await t.app().query<{ event_type: string }>(`SELECT event_type FROM platform.outbox`);
    expect(rows.map((r) => r.event_type)).toEqual(['notify.notification.sent']);
  });

  it('does not re-enqueue a FAILED row that is still waiting out its backoff', async () => {
    // FAILED is the ordinary resting state between two of BullMQ's own retries. Created long ago,
    // attempted a moment ago: the retry chain is alive and the sweep must leave it alone.
    await insertNotification(t.app(), {
      status: 'FAILED',
      attempt_count: 1,
      queued_at: new Date(Date.now() - 10 * 60_000),
      last_attempt_at: new Date(),
    });

    await expect(
      releaseStuck(t.db(), new Date(), { queuedAfterMs: 120_000, sendingAfterMs: 300_000 }),
    ).resolves.toEqual([]);
  });

  it('releases a FAILED row whose retry chain is gone', async () => {
    const id = await insertNotification(t.app(), {
      status: 'FAILED',
      attempt_count: 1,
      queued_at: new Date(Date.now() - 30 * 60_000),
      last_attempt_at: new Date(Date.now() - 20 * 60_000),
    });

    await expect(
      releaseStuck(t.db(), new Date(), { queuedAfterMs: 120_000, sendingAfterMs: 300_000 }),
    ).resolves.toEqual([{ notificationId: id, channel: 'EMAIL' }]);
  });

  it('rescues at most `limit` rows per sweep', async () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    await insertNotification(t.app(), { queued_at: stale });
    await insertNotification(t.app(), { queued_at: stale });

    await expect(
      releaseStuck(t.db(), new Date(), { queuedAfterMs: 120_000, sendingAfterMs: 300_000, limit: 1 }),
    ).resolves.toHaveLength(1);
  });
});
