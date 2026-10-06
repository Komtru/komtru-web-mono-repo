// The floor under the enqueue.
//
// Dispatch writes the notification row inside the subscriber's transaction and enqueues the send
// job after it commits. Those two steps are not atomic and cannot be: Redis is not in the database
// transaction. So the enqueue is allowed to be lost — Redis down, the process killed between the
// commit and the `add` — and this sweep, running every minute, is what makes that a delay rather
// than a notification nobody ever receives. It also un-sticks rows a killed worker left SENDING.
import type { Db } from '../../../db/index.js';
import type { NotifyConfig } from '../../../config/env.js';
import type { Logger } from '../../../platform/logger.js';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import { releaseStuck } from '../services/delivery.service.js';
import { enqueueSend } from './enqueue.js';

/** A row QUEUED longer than this has lost its job. Long enough that a slow worker is not swept. */
export const QUEUED_STUCK_AFTER_MS = 2 * 60_000;
/**
 * A row SENDING longer than this belonged to a worker that is gone. This window is the honest cost
 * of at-least-once: a provider call that succeeded but whose answer never reached us can be
 * repeated after it. Wide enough that no live job is ever stolen.
 */
export const SENDING_STUCK_AFTER_MS = 10 * 60_000;

export interface RequeueDeps {
  db: Db;
  queues: QueueFactory;
  config: NotifyConfig;
  logger: Logger;
}

export async function requeueStuck(deps: RequeueDeps, firedAt: Date): Promise<number> {
  const released = await releaseStuck(deps.db, firedAt, {
    queuedAfterMs: QUEUED_STUCK_AFTER_MS,
    sendingAfterMs: SENDING_STUCK_AFTER_MS,
  });

  for (const row of released) {
    await enqueueSend(deps.queues, deps.config, row, { deduplicate: false });
  }
  if (released.length) {
    deps.logger.warn({ count: released.length }, 'notify: re-enqueued notifications nobody was sending');
  }
  return released.length;
}
