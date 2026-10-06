// What start() wires up, driven with a stub ModuleContext.
//
// The destroy subscription is here rather than in an integration test because the thing that went
// wrong without it is structural: three of the four tombstone paths never enqueued a destroy, and no
// test anywhere asserted that a tombstone leads to one. This file is where that now fails loudly.
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@komtru/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { fileTombstoned } from '../../../src/modules/files/domain/events.js';
import { FILES_QUEUES } from '../../../src/modules/files/domain/queues.js';
import { createFilesModule } from '../../../src/modules/files/module.js';
import type { EventBus, EventSubscription } from '../../../src/platform/events/bus.js';
import type { Tx } from '../../../src/platform/events/publish.js';
import type { ModuleContext } from '../../../src/platform/module.js';
import { createLogger } from '../../../src/platform/logger.js';
import { registryConfig } from '../../support/modules.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

interface Harness {
  module: ReturnType<typeof createFilesModule>;
  subscriptions: EventSubscription[];
  added: { queue: string; jobName: string; data: unknown; options: unknown }[];
}

const start = async (): Promise<Harness> => {
  const module = createFilesModule();
  const subscriptions: EventSubscription[] = [];
  const added: Harness['added'] = [];

  const events = {
    subscribe: (subscription: EventSubscription) => subscriptions.push(subscription),
    subscribers: () => [],
    queueFor: (name: string) => name,
    publish: () => Promise.reject(new Error('not used')),
  } as unknown as EventBus;

  const queues = {
    producer: (queue: string) => ({
      add: (jobName: string, data: unknown, options: unknown) => {
        added.push({ queue, jobName, data, options });
        return Promise.resolve({ id: 'stub' });
      },
      remove: () => Promise.resolve(1),
    }),
  } as unknown as ModuleContext['queues'];

  await module.start?.({
    queues,
    events,
    emitter: {} as ModuleContext['emitter'],
    db: {} as ModuleContext['db'],
    config: registryConfig(),
    logger,
    redis: {} as ModuleContext['redis'],
  });

  return { module, subscriptions, added };
};

type TombstonedEnvelope = EventEnvelope<{
  fileId: string;
  category: string;
  reason: string;
  actorUserId: string | null;
}>;

const envelope = (fileId: string): TombstonedEnvelope => ({
  eventId: randomUUID(),
  eventType: fileTombstoned.eventType,
  version: 1,
  occurredAt: new Date().toISOString(),
  actor: { type: 'SYSTEM' },
  payload: { fileId, category: 'KYC_DOCUMENT', reason: 'dsr delete', actorUserId: null },
});

/** The bus erases the payload type at `subscribe`; a test calling a handler directly restores it. */
const call = (subscription: EventSubscription | undefined, fileId: string): Promise<void> =>
  (subscription as unknown as { handler: (e: TombstonedEnvelope, tx: Tx) => Promise<void> }).handler(
    envelope(fileId),
    {} as Tx,
  );

describe('files start()', () => {
  it('subscribes to its own file.tombstoned event', async () => {
    // Every tombstone path publishes it in the same transaction as the row change, so one subscriber
    // covers all of them: the admin endpoint, the DSR sweep, the abandoned-ticket sweep, the
    // rejection branch of reconciliation, and any future caller through the barrel.
    const { subscriptions } = await start();
    const destroy = subscriptions.find((s) => s.event.eventType === fileTombstoned.eventType);
    expect(destroy).toBeDefined();
    expect(destroy?.name).toBe('files.on-file-tombstoned');
  });

  it('enqueues the destroy job for the tombstoned file', async () => {
    const { subscriptions, added } = await start();
    const destroy = subscriptions.find((s) => s.event.eventType === fileTombstoned.eventType);
    const fileId = randomUUID();

    await call(destroy, fileId);

    expect(added).toHaveLength(1);
    const enqueued = added[0];
    expect(enqueued?.queue).toBe(FILES_QUEUES.DESTROY);
    expect(enqueued?.data).toEqual({ fileId });
    // The file id as the job id: a redelivered event must not queue a second destroy.
    expect(enqueued?.options).toMatchObject({ jobId: fileId });
  });

  it('does not let a failed enqueue roll back the event marker', async () => {
    // The tombstone row is already committed. Throwing here would take processed_events down with
    // it and redo a dispatch that has nothing left to do; the orphaned asset is logged instead.
    const module = createFilesModule();
    const subscriptions: EventSubscription[] = [];
    const events = {
      subscribe: (subscription: EventSubscription) => subscriptions.push(subscription),
    } as unknown as EventBus;
    const queues = {
      producer: () => ({
        add: () => Promise.reject(new Error('redis is down')),
        remove: () => Promise.resolve(1),
      }),
    } as unknown as ModuleContext['queues'];
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    await module.start?.({
      queues,
      events,
      emitter: {} as ModuleContext['emitter'],
      db: {} as ModuleContext['db'],
      config: registryConfig(),
      logger,
      redis: {} as ModuleContext['redis'],
    });

    const destroy = subscriptions.find((s) => s.event.eventType === fileTombstoned.eventType);
    await expect(call(destroy, randomUUID())).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
