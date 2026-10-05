// The events platform (design §4.3): publish through the outbox, subscribe through the bus, and the
// in-process emitter for effects that are safe to lose.
export { publish, publishInOwnTransaction, type PublishInput, type Tx } from './publish.js';
export {
  createEventBus,
  hasProcessed,
  queueFor,
  SUBSCRIBER_QUEUE_PREFIX,
  type EventBus,
  type EventSubscription,
} from './bus.js';
export {
  startOutboxRelay,
  OUTBOX_BATCH_SIZE,
  OUTBOX_POLL_MS,
  OUTBOX_RETENTION_DAYS,
  PROCESSED_RETENTION_DAYS,
  type RunningRelay,
} from './relay.js';
export { createInProcessEmitter, type InProcessEmitter } from './emitter.js';
