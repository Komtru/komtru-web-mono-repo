// The send job against a stub provider and a real database: one provider call per notification,
// however many times the job runs, and none at all in dry run. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { UnrecoverableError } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NotifyConfig } from '../../../../src/config/env.js';
import { loadConfig } from '../../../../src/config/env.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { DRY_RUN_REFERENCE, runSendJob } from '../../../../src/modules/notify/jobs/send.job.js';
import { infraEnabled, testRedisUrl } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { startStubServer, type StubServer } from '../../../support/stub-server.js';
import { insertNotification, insertUser, insertVerifiedPhone } from '../support.js';

const logger = createLogger(
  loadConfig({ LOG_LEVEL: 'silent', POSTGRES_URL: 'postgresql://x@localhost/x', REDIS_URL: testRedisUrl() }),
);

const json =
  (body: unknown, status = 200) =>
  (_req: unknown, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

describe.runIf(infraEnabled)('runSendJob', () => {
  const t = useTestDatabase();
  let stub: StubServer | undefined;
  let userId: string;

  const config = (overrides: Partial<NotifyConfig> = {}): NotifyConfig => ({
    defaultLocale: 'en-NG',
    maxAttempts: 5,
    retryBaseDelayMs: 10,
    rateLimitWindowMinutes: 60,
    rateLimitMaxPerWindow: 20,
    smsDryRun: false,
    pushDryRun: false,
    termii: { apiKey: 'key', senderId: 'Komtru', baseUrl: stub?.url ?? '' },
    ...overrides,
  });

  const deps = (overrides: Partial<NotifyConfig> = {}) => ({
    db: t.db(),
    config: config(overrides),
    logger,
  });

  const smsNotification = (overrides: Record<string, unknown> = {}) =>
    insertNotification(t.app(), {
      user_id: userId,
      channel: 'SMS',
      category: 'SECURITY',
      rendered_body: 'Your code is 123456',
      recipient_masked: '+23480•••5678',
      ...overrides,
    });

  const row = async (id: string) => {
    const { rows } = await t.app().query<{
      status: string;
      provider_reference: string | null;
      attempt_count: number;
      failed_reason: string | null;
    }>(
      `SELECT status, provider_reference, attempt_count, failed_reason
         FROM notify.notifications WHERE id = $1`,
      [id],
    );
    return rows[0];
  };

  const attempts = async (id: string) => {
    const { rows } = await t
      .app()
      .query<{ count: string }>(
        `SELECT count(*) FROM notify.notification_delivery_attempts WHERE notification_id = $1`,
        [id],
      );
    return Number(rows[0]?.count ?? 0);
  };

  beforeEach(async () => {
    userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345678');
    stub = await startStubServer(json({ message_id: 'tm-1' }));
  });

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  it('sends once and records the provider reference', async () => {
    const id = await smsNotification();

    await runSendJob(deps(), { notificationId: id });

    expect(stub?.hits).toHaveLength(1);
    expect(await row(id)).toMatchObject({ status: 'SENT', provider_reference: 'tm-1' });
    expect(await attempts(id)).toBe(1);
  });

  it('calls the provider once when the job runs twice for one notification', async () => {
    const id = await smsNotification();

    await runSendJob(deps(), { notificationId: id });
    await runSendJob(deps(), { notificationId: id });

    // The claim is what stops the second SMS, not the queue and not processed_events.
    expect(stub?.hits).toHaveLength(1);
    expect(await row(id)).toMatchObject({ status: 'SENT', attempt_count: 1 });
  });

  it('is a quiet no-op for a notification that does not exist', async () => {
    await expect(runSendJob(deps(), { notificationId: randomUUID() })).resolves.toBeUndefined();
    expect(stub?.hits).toEqual([]);
  });

  it('makes no provider call in SMS dry run, and still records the send', async () => {
    const id = await smsNotification();

    await runSendJob(deps({ smsDryRun: true }), { notificationId: id });

    expect(stub?.hits).toEqual([]);
    expect(await row(id)).toMatchObject({ status: 'SENT', provider_reference: DRY_RUN_REFERENCE });
  });

  it('makes no provider call when the channel has no credentials', async () => {
    const id = await smsNotification();

    await runSendJob(
      { db: t.db(), config: { ...config(), termii: undefined }, logger },
      { notificationId: id },
    );

    expect(stub?.hits).toEqual([]);
    expect(await row(id)).toMatchObject({ status: 'SENT', provider_reference: DRY_RUN_REFERENCE });
  });

  it('records a failed attempt and rethrows so the queue retries', async () => {
    await stub?.close();
    stub = await startStubServer(json({ message: 'boom' }, 500));
    const id = await smsNotification();

    await expect(
      runSendJob(
        { ...deps(), config: config({ termii: { apiKey: 'k', senderId: 'K', baseUrl: stub.url } }) },
        { notificationId: id },
      ),
    ).rejects.toThrow();

    expect(await row(id)).toMatchObject({ status: 'FAILED', attempt_count: 1 });
    expect(await attempts(id)).toBe(1);
  });

  it('dead-letters on the last attempt and throws UnrecoverableError', async () => {
    await stub?.close();
    stub = await startStubServer(json({ message: 'boom' }, 500));
    const id = await smsNotification({ status: 'FAILED', attempt_count: 1 });
    const deadLetterConfig = config({
      maxAttempts: 2,
      termii: { apiKey: 'k', senderId: 'K', baseUrl: stub.url },
    });

    await expect(
      runSendJob({ db: t.db(), config: deadLetterConfig, logger }, { notificationId: id }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(await row(id)).toMatchObject({ status: 'DEAD_LETTERED', attempt_count: 2 });
    const { rows } = await t
      .app()
      .query<{ event_type: string }>(`SELECT event_type FROM platform.outbox ORDER BY seq`);
    expect(rows.map((r) => r.event_type)).toContain('notify.notification.dead_lettered');
  });

  it('dead-letters without retrying when the address has gone away', async () => {
    const stranded = await insertUser(t.app());
    const id = await smsNotification({ user_id: stranded });

    await expect(runSendJob(deps(), { notificationId: id })).rejects.toBeInstanceOf(UnrecoverableError);

    expect(stub?.hits).toEqual([]);
    expect(await row(id)).toMatchObject({ status: 'DEAD_LETTERED' });
  });
});
