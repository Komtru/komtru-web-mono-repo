// The subscriber's half of the pipeline: one row per send, charged once, suppressed with a reason,
// and never silent about a security message. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { EventEnvelope, NotificationChannel } from '@komtru/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotifyConfig } from '../../../../src/config/env.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { loadConfig } from '../../../../src/config/env.js';
import { notificationIdFor } from '../../../../src/modules/notify/domain/identity.js';
import {
  dispatchForEvent,
  type QueuedSend,
} from '../../../../src/modules/notify/services/dispatch.service.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertUser, insertVerifiedEmail, insertVerifiedPhone } from '../support.js';

const logger = createLogger(
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://x@localhost/x',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
  }),
);

const notifyConfig = (overrides: Partial<NotifyConfig> = {}): NotifyConfig => ({
  defaultLocale: 'en-NG',
  maxAttempts: 5,
  retryBaseDelayMs: 10,
  rateLimitWindowMinutes: 60,
  rateLimitMaxPerWindow: 20,
  smsDryRun: true,
  pushDryRun: true,
  ...overrides,
});

const TEMPLATE_KEY = 'test.alert';
const EVENT_NAME = 'test.alert.raised';

const envelope = (overrides: Partial<EventEnvelope<unknown>> = {}): EventEnvelope<unknown> => ({
  eventId: randomUUID(),
  eventType: EVENT_NAME,
  version: 1,
  occurredAt: new Date().toISOString(),
  actor: { type: 'SYSTEM' },
  payload: {},
  ...overrides,
});

describe.runIf(infraEnabled)('dispatchForEvent', () => {
  const t = useTestDatabase();
  let userId: string;

  const seedTemplate = async (overrides: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      template_key: TEMPLATE_KEY,
      channel: 'SMS',
      category: 'TRADE',
      body: 'hello {{name}}',
      variables: ['name'],
      is_security_critical: false,
      ...overrides,
    };
    const columns = Object.keys(values);
    await t.app().query(
      `INSERT INTO notify.notification_templates (${columns.join(', ')})
         VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
      Object.values(values),
    );
  };

  const seedMapping = async (enabled = true) => {
    await t.app().query(
      `INSERT INTO notify.notification_event_mappings (event_name, template_key, enabled)
         VALUES ($1, $2, $3)`,
      [EVENT_NAME, TEMPLATE_KEY, enabled],
    );
  };

  const dispatch = (input: {
    envelope?: EventEnvelope<unknown>;
    variables?: Record<string, string>;
    config?: NotifyConfig;
    channels?: NotificationChannel[];
    templateKey?: string;
    recipientId?: string;
  }) =>
    t.db().transaction((tx) =>
      dispatchForEvent({ config: input.config ?? notifyConfig(), logger }, tx, {
        envelope: input.envelope ?? envelope(),
        templateKey: input.templateKey ?? TEMPLATE_KEY,
        recipients: [
          {
            userId: input.recipientId ?? userId,
            variables: input.variables ?? { name: 'Ada' },
            ...(input.channels ? { channels: input.channels } : {}),
          },
        ],
      }),
    );

  const rows = async () => {
    const { rows: found } = await t.app().query<{
      id: string;
      channel: string;
      status: string;
      failed_reason: string | null;
      rendered_body: string;
      recipient_masked: string | null;
      sent_at: Date | null;
    }>(`SELECT id, channel, status, failed_reason, rendered_body, recipient_masked, sent_at
          FROM notify.notifications ORDER BY channel`);
    return found;
  };

  const rateLimitCount = async () => {
    const { rows: found } = await t
      .app()
      .query<{ send_count: number }>(`SELECT send_count FROM notify.notification_rate_limits`);
    return found[0]?.send_count ?? 0;
  };

  const outboxTypes = async () => {
    const { rows: found } = await t
      .app()
      .query<{ event_type: string }>(`SELECT event_type FROM platform.outbox ORDER BY seq`);
    return found.map((row) => row.event_type);
  };

  beforeEach(async () => {
    userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345678');
    await insertVerifiedEmail(t.app(), userId, 'ada@example.com');
  });

  it('writes one QUEUED row per channel the template declares', async () => {
    await seedTemplate();
    await seedTemplate({ channel: 'EMAIL', subject: 'Hi {{name}}', variables: ['name'] });
    await seedMapping();

    const queued = await dispatch({});

    expect(queued.map((q: QueuedSend) => q.channel).sort()).toEqual(['EMAIL', 'SMS']);
    expect((await rows()).map((r) => [r.channel, r.status])).toEqual([
      ['EMAIL', 'QUEUED'],
      ['SMS', 'QUEUED'],
    ]);
  });

  it('renders the body and stores only the masked recipient', async () => {
    await seedTemplate();
    await seedMapping();

    await dispatch({});

    expect((await rows())[0]).toMatchObject({
      rendered_body: 'hello Ada',
      recipient_masked: '+23480•••5678',
    });
  });

  it('writes the same rows and charges the cap once when the handler runs twice', async () => {
    await seedTemplate();
    await seedMapping();
    const event = envelope();

    const first = await dispatch({ envelope: event });
    const second = await dispatch({ envelope: event });

    expect(first).toHaveLength(1);
    // The second run collides with the deterministic id and returns nothing to enqueue: the whole
    // point of the boundary.
    expect(second).toEqual([]);
    expect(await rows()).toHaveLength(1);
    expect(await rateLimitCount()).toBe(1);
  });

  it('uses an id derived from the event, the template, the channel and the user', async () => {
    await seedTemplate();
    await seedMapping();
    const event = envelope();

    await dispatch({ envelope: event });

    expect((await rows())[0]?.id).toBe(
      notificationIdFor({
        eventId: event.eventId,
        templateKey: TEMPLATE_KEY,
        channel: 'SMS',
        userId,
      }),
    );
  });

  it('suppresses a non-critical notification the user opted out of, and says why', async () => {
    await seedTemplate();
    await seedMapping();
    await t.app().query(
      `INSERT INTO notify.notification_preferences (user_id, category, channel, opted_in)
         VALUES ($1, 'TRADE', 'SMS', false)`,
      [userId],
    );

    expect(await dispatch({})).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: 'SUPPRESSED', failed_reason: 'preference_opt_out' });
    expect(await rateLimitCount()).toBe(0);
  });

  it('sends a security-critical notification although the user opted out of SECURITY', async () => {
    await seedTemplate({ category: 'SECURITY', is_security_critical: true });
    await seedMapping();
    await t.app().query(
      `INSERT INTO notify.notification_preferences (user_id, category, channel, opted_in)
         VALUES ($1, 'SECURITY', 'SMS', false)`,
      [userId],
    );

    expect(await dispatch({})).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: 'QUEUED' });
  });

  it('suppresses over the cap', async () => {
    await seedTemplate();
    await seedMapping();

    expect(await dispatch({ config: notifyConfig({ rateLimitMaxPerWindow: 1 }) })).toHaveLength(1);
    const second = await dispatch({
      envelope: envelope(),
      config: notifyConfig({ rateLimitMaxPerWindow: 1 }),
    });

    expect(second).toEqual([]);
    expect((await rows()).map((r) => r.status)).toEqual(['QUEUED', 'SUPPRESSED']);
  });

  it('never rate-limits a security-critical notification', async () => {
    await seedTemplate({ category: 'SECURITY', is_security_critical: true });
    await seedMapping();
    const config = notifyConfig({ rateLimitMaxPerWindow: 1 });

    await dispatch({ config });
    const second = await dispatch({ envelope: envelope(), config });

    expect(second).toHaveLength(1);
    expect((await rows()).every((r) => r.status === 'QUEUED')).toBe(true);
  });

  it('dead-letters a security-critical SMS with no verified phone, and publishes it', async () => {
    const stranded = await insertUser(t.app());
    await seedTemplate({ category: 'SECURITY', is_security_critical: true });
    await seedMapping();

    await t.db().transaction((tx) =>
      dispatchForEvent({ config: notifyConfig(), logger }, tx, {
        envelope: envelope(),
        templateKey: TEMPLATE_KEY,
        recipients: [{ userId: stranded, variables: { name: 'Ada' } }],
      }),
    );

    expect((await rows())[0]).toMatchObject({ status: 'DEAD_LETTERED', failed_reason: 'no_destination' });
    expect(await outboxTypes()).toEqual(['notify.notification.dead_lettered']);
  });

  it('suppresses, without escalating, a non-critical notification with no destination', async () => {
    const stranded = await insertUser(t.app());
    await seedTemplate();
    await seedMapping();

    await t.db().transaction((tx) =>
      dispatchForEvent({ config: notifyConfig(), logger }, tx, {
        envelope: envelope(),
        templateKey: TEMPLATE_KEY,
        recipients: [{ userId: stranded, variables: { name: 'Ada' } }],
      }),
    );

    expect((await rows())[0]).toMatchObject({ status: 'SUPPRESSED', failed_reason: 'no_destination' });
    expect(await outboxTypes()).toEqual([]);
  });

  it('records an IN_APP notification SENT with no job to run, and publishes notification.sent', async () => {
    await seedTemplate({ channel: 'IN_APP' });
    await seedMapping();

    expect(await dispatch({})).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: 'SENT' });
    expect((await rows())[0]?.sent_at).toBeInstanceOf(Date);
    expect(await outboxTypes()).toEqual(['notify.notification.sent']);
  });

  it('does nothing when the mapping is disabled', async () => {
    await seedTemplate();
    await seedMapping(false);

    expect(await dispatch({})).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('sends a security-critical template even when its mapping is disabled', async () => {
    // D5's switch is for noisy notifications. Letting an operator disable OTP delivery
    // platform-wide, with no row and no event to show for it, is the D2 failure mode.
    await seedTemplate({ category: 'SECURITY', is_security_critical: true });
    await seedMapping(false);

    expect(await dispatch({})).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: 'QUEUED' });
  });

  it('sends a security-critical template even when its mapping row was deleted', async () => {
    await seedTemplate({ category: 'SECURITY', is_security_critical: true });

    expect(await dispatch({})).toHaveLength(1);
  });

  it('does nothing when there is no mapping at all', async () => {
    await seedTemplate();

    expect(await dispatch({})).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('prefers the user locale and falls back to the default', async () => {
    await seedTemplate({ locale: 'en-NG', body: 'default {{name}}' });
    await seedTemplate({ locale: 'fr-FR', body: 'francais {{name}}' });
    await seedMapping();
    await t.app().query(`UPDATE identity.users SET locale = 'fr-FR' WHERE id = $1`, [userId]);

    await dispatch({});

    expect((await rows())[0]?.rendered_body).toBe('francais Ada');
  });

  it('takes the highest active version of a template', async () => {
    await seedTemplate({ version: 1, body: 'old {{name}}' });
    await seedTemplate({ version: 2, body: 'new {{name}}' });
    await seedMapping();

    await dispatch({});

    expect((await rows())[0]?.rendered_body).toBe('new Ada');
  });

  it('ignores an inactive template', async () => {
    await seedTemplate({ version: 1, body: 'old {{name}}' });
    await seedTemplate({ version: 2, body: 'new {{name}}', active: false });
    await seedMapping();

    await dispatch({});

    expect((await rows())[0]?.rendered_body).toBe('old Ada');
  });

  it('dead-letters only the channel whose template cannot be rendered', async () => {
    // A broken EMAIL copy must not cost the user the SMS for the same event: the handler runs in
    // one transaction, so throwing would roll back both and the retry would reproduce it exactly.
    await seedTemplate({ channel: 'SMS', body: 'fine {{name}}', variables: ['name'] });
    await seedTemplate({
      channel: 'EMAIL',
      subject: 'Hi',
      body: 'needs {{missing}}',
      variables: ['missing'],
    });
    await seedMapping();

    const queued = await dispatch({ variables: { name: 'Ada' } });

    expect(queued.map((q: QueuedSend) => q.channel)).toEqual(['SMS']);
    expect((await rows()).map((r) => [r.channel, r.status])).toEqual([
      ['EMAIL', 'DEAD_LETTERED'],
      ['SMS', 'QUEUED'],
    ]);
    // The unrendered body is kept: it is the evidence of what the template actually said.
    expect((await rows())[0]?.rendered_body).toBe('needs {{missing}}');
  });

  it('escalates an unrenderable security-critical template', async () => {
    await seedTemplate({
      category: 'SECURITY',
      is_security_critical: true,
      body: 'needs {{missing}}',
      variables: ['missing'],
    });
    await seedMapping();

    await dispatch({ variables: {} });

    expect((await rows())[0]).toMatchObject({ status: 'DEAD_LETTERED' });
    expect(await outboxTypes()).toEqual(['notify.notification.dead_lettered']);
  });

  it('does not escalate an unrenderable ordinary template', async () => {
    await seedTemplate({ body: 'needs {{missing}}', variables: ['missing'] });
    await seedMapping();

    await dispatch({ variables: {} });

    expect((await rows())[0]).toMatchObject({ status: 'DEAD_LETTERED' });
    expect(await outboxTypes()).toEqual([]);
  });

  it('drops a notification addressed to a user that no longer exists', async () => {
    await seedTemplate();
    await seedMapping();

    const queued = await t.db().transaction((tx) =>
      dispatchForEvent({ config: notifyConfig(), logger }, tx, {
        envelope: envelope(),
        templateKey: TEMPLATE_KEY,
        recipients: [{ userId: randomUUID(), variables: { name: 'Ada' } }],
      }),
    );

    expect(queued).toEqual([]);
    expect(await rows()).toEqual([]);
  });
});

describe.runIf(infraEnabled)('channel targeting and unverified destinations (T-032)', () => {
  const t = useTestDatabase();

  const seedTemplate = async (overrides: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      template_key: 'identity.otp.requested',
      channel: 'SMS',
      category: 'SECURITY',
      body: 'code {{code}}',
      variables: ['code'],
      is_security_critical: true,
      ...overrides,
    };
    const columns = Object.keys(values);
    await t.app().query(
      `INSERT INTO notify.notification_templates (${columns.join(', ')})
         VALUES (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
      Object.values(values),
    );
  };

  const seedMapping = async (templateKey: string, eventName: string) => {
    await t.app().query(
      `INSERT INTO notify.notification_event_mappings (event_name, template_key, enabled)
           VALUES ($1, $2, true)`,
      [eventName, templateKey],
    );
  };

  const dispatchOtp = (userId: string, channels?: NotificationChannel[]) =>
    t.db().transaction((tx) =>
      dispatchForEvent({ config: notifyConfig(), logger }, tx, {
        envelope: envelope({ eventType: 'identity.otp.requested' }),
        templateKey: 'identity.otp.requested',
        recipients: [{ userId, variables: { code: '482913' }, ...(channels ? { channels } : {}) }],
      }),
    );

  const rows = async () =>
    (
      await t
        .app()
        .query<{ channel: string; status: string; failed_reason: string | null }>(
          `SELECT channel, status, failed_reason FROM notify.notifications ORDER BY channel`,
        )
    ).rows;

  beforeEach(async () => {
    await seedTemplate();
    await seedTemplate({ channel: 'EMAIL', subject: 'Your code', body: 'code {{code}}' });
    await seedMapping('identity.otp.requested', 'identity.otp.requested');
  });

  it('sends only the channels the recipient names', async () => {
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345678');
    await insertVerifiedEmail(t.app(), userId, 'ada@example.com');

    await dispatchOtp(userId, ['SMS']);
    expect(await rows()).toMatchObject([{ channel: 'SMS', status: 'QUEUED' }]);
  });

  it('fans out to every channel when the recipient names none', async () => {
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345678');
    await insertVerifiedEmail(t.app(), userId, 'ada@example.com');

    await dispatchOtp(userId);
    expect((await rows()).map((r) => r.channel)).toEqual(['EMAIL', 'SMS']);
  });

  it('throws when a recipient names a channel the template does not have', async () => {
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345678');
    // Silence here would be a security-critical message nobody sent and nobody logged.
    await expect(dispatchOtp(userId, ['PUSH'])).rejects.toThrow(/no template for the requested channel/);
  });

  it('addresses an OTP to an UNVERIFIED primary phone', async () => {
    const userId = await insertUser(t.app(), { status: 'PENDING_VERIFICATION' });
    await t.app().query(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary)
           VALUES ($1, '+2348012345678', 'NG', true)`,
      [userId],
    );

    await dispatchOtp(userId, ['SMS']);
    // Without the allowance this row is DEAD_LETTERED and no registration SMS ever leaves.
    expect(await rows()).toMatchObject([{ channel: 'SMS', status: 'QUEUED' }]);
  });

  it('still refuses an unverified address for every other template', async () => {
    await seedTemplate({
      template_key: 'identity.password.changed',
      channel: 'EMAIL',
      subject: 'Changed',
      body: 'changed at {{changedAt}}',
      variables: ['changedAt'],
    });
    await seedMapping('identity.password.changed', 'identity.password.changed');

    const userId = await insertUser(t.app());
    await t.app().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary)
           VALUES ($1, 'ada@example.com', 'ada@example.com', true)`,
      [userId],
    );

    await t.db().transaction((tx) =>
      dispatchForEvent({ config: notifyConfig(), logger }, tx, {
        envelope: envelope({ eventType: 'identity.password.changed' }),
        templateKey: 'identity.password.changed',
        recipients: [{ userId, variables: { changedAt: 'today' }, channels: ['EMAIL'] }],
      }),
    );

    expect(await rows()).toMatchObject([
      { channel: 'EMAIL', status: 'DEAD_LETTERED', failed_reason: 'no_destination' },
    ]);
  });

  it('sends a reset code to the VERIFIED address even when an unverified one is primary', async () => {
    // The allowance is a FALLBACK for an account with nothing proven, not a preference. Preferring
    // the primary would send a recovery code to an address the account holder never confirmed —
    // exactly what the verified-only filter exists to stop.
    const userId = await insertUser(t.app());
    await t.app().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
           VALUES ($1, 'proven@example.com', 'proven@example.com', false, now())`,
      [userId],
    );
    await t.app().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary)
           VALUES ($1, 'unproven@example.com', 'unproven@example.com', true)`,
      [userId],
    );

    await dispatchOtp(userId, ['EMAIL']);
    const { rows: found } = await t
      .app()
      .query<{ recipient_masked: string }>(`SELECT recipient_masked FROM notify.notifications`);
    expect(found[0]?.recipient_masked).toBe('p•••@example.com');
  });

  it('prefers the verified contact when both a verified and an unverified one exist', async () => {
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345678');
    // A second, unverified number that is NOT primary: the primary verified one must win.
    await t.app().query(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary)
           VALUES ($1, '+2348099999999', 'NG', false)`,
      [userId],
    );

    await dispatchOtp(userId, ['SMS']);
    const { rows: found } = await t
      .app()
      .query<{ recipient_masked: string }>(`SELECT recipient_masked FROM notify.notifications`);
    expect(found[0]?.recipient_masked).toBe('+23480•••5678');
  });
});
