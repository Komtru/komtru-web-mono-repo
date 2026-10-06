// What the module does at boot: refuse to start on a bad catalogue, seed a good one, and never
// stamp over what an operator edited. Skipped unless KOMTRU_INFRA_TESTS=1.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/platform/logger.js';
import { createEventBus } from '../../../src/platform/events/bus.js';
import { createInProcessEmitter } from '../../../src/platform/events/emitter.js';
import { createQueueFactory, type QueueFactory } from '../../../src/platform/queue/factory.js';
import type { ModuleContext } from '../../../src/platform/module.js';
import { createNotifyModule } from '../../../src/modules/notify/index.js';
import { CATALOGUE } from '../../../src/modules/notify/domain/catalogue.js';
import { templateSchema } from '../../../src/modules/notify/domain/template.js';
import { infraEnabled, pooledUrl, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase, workerDatabase } from '../../support/db.js';

describe.runIf(infraEnabled)('notify module', () => {
  const t = useTestDatabase();
  let factory: QueueFactory | undefined;

  const config = (overrides: Record<string, string> = {}) =>
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      POSTGRES_URL: pooledUrl(workerDatabase()),
      REDIS_URL: testRedisUrl(),
      ...overrides,
    });

  const context = (overrides: Record<string, string> = {}): ModuleContext => {
    const appConfig = config(overrides);
    const logger = createLogger(appConfig);
    factory = createQueueFactory({ redisUrl: appConfig.redis.url, logger });
    const db = t.db();
    return {
      db,
      config: appConfig,
      logger,
      queues: factory,
      emitter: createInProcessEmitter(logger),
      events: createEventBus({ db, queues: factory, logger, role: 'api' }),
    };
  };

  const templateCount = async () => {
    const { rows } = await t
      .app()
      .query<{ count: string }>(`SELECT count(*) FROM notify.notification_templates`);
    return Number(rows[0]?.count ?? 0);
  };

  beforeEach(async () => {
    await factory?.close();
    factory = undefined;
  });

  it('seeds the shipped catalogue', async () => {
    const module = createNotifyModule();

    await module.start?.(context());

    expect(await templateCount()).toBe(CATALOGUE.templates.length);
    const { rows } = await t
      .app()
      .query<{ count: string }>(`SELECT count(*) FROM notify.notification_event_mappings`);
    expect(Number(rows[0]?.count)).toBe(CATALOGUE.mappings.length);
  });

  it('seeds once, however many processes start', async () => {
    await createNotifyModule().start?.(context());
    await factory?.close();
    factory = undefined;
    await createNotifyModule().start?.(context());

    expect(await templateCount()).toBe(CATALOGUE.templates.length);
  });

  it('never stamps over a template an operator edited', async () => {
    await createNotifyModule().start?.(context());
    await t.app().query(
      `UPDATE notify.notification_templates SET body = 'operator wrote this'
          WHERE template_key = 'identity.password.changed' AND channel = 'PUSH'`,
    );
    await factory?.close();
    factory = undefined;

    await createNotifyModule().start?.(context());

    const { rows } = await t.app().query<{ body: string }>(
      `SELECT body FROM notify.notification_templates
          WHERE template_key = 'identity.password.changed' AND channel = 'PUSH'`,
    );
    expect(rows[0]?.body).toBe('operator wrote this');
  });

  it('refuses to start when a template declares a variable its body never uses', async () => {
    const module = createNotifyModule({
      catalogue: {
        templates: [
          templateSchema.parse({
            templateKey: 'test.broken',
            channel: 'SMS',
            category: 'ACCOUNT',
            body: 'no placeholders here',
            variables: ['name'],
          }),
        ],
        mappings: [],
      },
    });

    await expect(module.start?.(context())).rejects.toThrow(/test\.broken.*name/s);
    // Nothing was written: the check runs before the sync.
    expect(await templateCount()).toBe(0);
  });

  it('refuses to start when a mapping has no template', async () => {
    const module = createNotifyModule({
      catalogue: {
        templates: [],
        mappings: [{ eventName: 'test.thing.happened', templateKey: 'test.missing', enabled: true }],
      },
    });

    await expect(module.start?.(context())).rejects.toThrow(/test\.missing/);
  });

  it('declares one send queue per provider channel and the stuck sweep', () => {
    const module = createNotifyModule();

    expect(module.queues?.map((q) => q.name)).toEqual([
      'notify.send-email',
      'notify.send-sms',
      'notify.send-push',
    ]);
    expect(module.schedules?.map((s) => s.name)).toEqual(['notify.requeue-stuck']);
  });

  it('registers one subscriber per binding', async () => {
    const ctx = context();
    const module = createNotifyModule({
      bindings: [],
      catalogue: { templates: [], mappings: [] },
    });

    await module.start?.(ctx);

    expect(ctx.events.subscribers('identity.otp.requested')).toEqual([]);
  });
  it('refuses to start in production when a channel the catalogue uses cannot send', async () => {
    // A rotated key that never reached the deployment would otherwise dead-letter every OTP that
    // night. Named at boot instead.
    const module = createNotifyModule();

    await expect(module.start?.(context({ NODE_ENV: 'production' }))).rejects.toThrow(/TERMII/);
  });

  it('starts outside production with no provider credentials at all', async () => {
    // A developer with no FCM account still has to be able to boot; the dry-run defaults mean
    // nothing is sent anyway.
    await expect(createNotifyModule().start?.(context())).resolves.toBeUndefined();
  });
});
