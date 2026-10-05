// The notify schema's shape and the invariants it enforces (M11 §4). Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { enumLabels, insertNotification, sqlState } from '../../support.js';

describe.runIf(infraEnabled)('notify schema', () => {
  const t = useTestDatabase();

  it.each([
    ['notification_channel', ['PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'VOICE', 'IN_APP']],
    [
      'notification_status',
      ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'DEAD_LETTERED', 'SUPPRESSED'],
    ],
    ['notification_category', ['SECURITY', 'TRADE', 'PAYMENT', 'DISPUTE', 'TICKET', 'MARKETING', 'ACCOUNT']],
  ])('declares %s in the notify schema', async (name, labels) => {
    await expect(enumLabels(t.owner(), 'notify', name)).resolves.toEqual(labels);
  });

  it('rejects a SUPPRESSED notification with no reason', async () => {
    await expect(sqlState(insertNotification(t.app(), { status: 'SUPPRESSED' }))).resolves.toBe('23514');
  });

  it('accepts a SUPPRESSED notification that says why', async () => {
    await expect(
      insertNotification(t.app(), { status: 'SUPPRESSED', failed_reason: 'preference_opt_out' }),
    ).resolves.toEqual(expect.any(String));
  });

  it('rejects a second notification with the same id', async () => {
    const id = randomUUID();
    await insertNotification(t.app(), { id });
    await expect(sqlState(insertNotification(t.app(), { id }))).resolves.toBe('23505');
  });

  it('keeps one template per key, channel, locale and version', async () => {
    const insert = () =>
      t.app().query(
        `INSERT INTO notify.notification_templates (template_key, channel, category, body)
           VALUES ('test.dup', 'SMS', 'ACCOUNT', 'hello')`,
      );
    await insert();
    await expect(sqlState(insert())).resolves.toBe('23505');
  });

  it('keeps one preference row per user, category and channel', async () => {
    const userId = randomUUID();
    const insert = () =>
      t.app().query(
        `INSERT INTO notify.notification_preferences (user_id, category, channel, opted_in)
           VALUES ($1, 'MARKETING', 'SMS', false)`,
        [userId],
      );
    await insert();
    await expect(sqlState(insert())).resolves.toBe('23505');
  });

  it('refuses an UPDATE of a delivery attempt by the runtime role', async () => {
    const notificationId = await insertNotification(t.app());
    await t.app().query(
      `INSERT INTO notify.notification_delivery_attempts (notification_id, attempt_number, succeeded)
         VALUES ($1, 1, true)`,
      [notificationId],
    );
    await expect(
      sqlState(
        t
          .app()
          .query(
            `UPDATE notify.notification_delivery_attempts SET succeeded = false WHERE notification_id = $1`,
            [notificationId],
          ),
      ),
    ).resolves.toBe('42501');
  });

  it('cascades delivery attempts when the owner removes their notification', async () => {
    const notificationId = await insertNotification(t.app());
    await t.app().query(
      `INSERT INTO notify.notification_delivery_attempts (notification_id, attempt_number, succeeded)
         VALUES ($1, 1, false)`,
      [notificationId],
    );
    // The append-only trigger rejects the cascaded DELETE for everyone, the owner included: a
    // notification's attempt history is the evidence that a user was or was not told.
    await expect(
      sqlState(t.owner().query(`DELETE FROM notify.notifications WHERE id = $1`, [notificationId])),
    ).resolves.toBe('KT001');
  });

  it('defaults a template to the base locale, version 1, active and not security critical', async () => {
    await t.app().query(
      `INSERT INTO notify.notification_templates (template_key, channel, category, body)
         VALUES ('test.defaults', 'SMS', 'ACCOUNT', 'hello')`,
    );
    const { rows } = await t.app().query<{
      locale: string;
      version: number;
      active: boolean;
      is_security_critical: boolean;
      variables: string[];
    }>(`SELECT locale, version, active, is_security_critical, variables
          FROM notify.notification_templates WHERE template_key = 'test.defaults'`);
    expect(rows[0]).toEqual({
      locale: 'en-NG',
      version: 1,
      active: true,
      is_security_critical: false,
      variables: [],
    });
  });
});
