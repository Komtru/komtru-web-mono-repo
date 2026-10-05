// The subscriber's half of the pipeline: one row per send, charged once, suppressed with a reason,
// and never silent about a security message. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@komtru/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotifyConfig } from '../../../../src/config/env.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { loadConfig } from '../../../../src/config/env.js';
import { notificationIdFor } from '../../../../src/modules/notify/domain/identity.js';
import {
  dispatchForEvent,
  type QueuedSend,
} from '../../../../src/modules/notify/services/dispatch.service.js';
import { infraEnabled, testRedisUrl } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertUser, insertVerifiedEmail, insertVerifiedPhone } from '../support.js';

const logger = createLogger(
  loadConfig({ LOG_LEVEL: 'silent', POSTGRES_URL: 'postgresql://x@localhost/x', REDIS_URL: testRedisUrl() }),
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
  }) =>
    t.db().transaction((tx) =>
      dispatchForEvent({ config: input.config ?? notifyConfig(), logger }, tx, {
        envelope: input.envelope ?? envelope(),
        templateKey: TEMPLATE_KEY,
        recipients: [{ userId, variables: input.variables ?? { name: 'Ada' } }],
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

  it('fails loudly when a binding does not supply a variable the template needs', async () => {
    await seedTemplate();
    await seedMapping();

    await expect(dispatch({ variables: {} })).rejects.toThrow(/test\.alert.*name/);
    expect(await rows()).toEqual([]);
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
