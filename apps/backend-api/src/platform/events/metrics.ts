// In-process outbox metrics, read by the metrics exporter (later ticket) the way `deadLetterCounter`
// is. "Events stopped flowing" has to be an alert, not a log grep: the backlog gauge and the
// oldest-unpublished age are what an operator watches when a subscriber queue or Redis is wedged.
interface OutboxMetrics {
  /** Unpublished rows at the last measurement. */
  backlog: number;
  /** Age of the oldest unpublished row, or null when the outbox is drained. */
  oldestUnpublishedAgeMs: number | null;
  /** Ticks that failed outright (Redis down, enqueue deadline, lock contention is not counted). */
  tickFailures: number;
  /** Rows the relay could not turn into a valid envelope; they are marked published and logged. */
  unprocessable: number;
  /** Rows published without waiting for the commit watermark, because the wait ran out. */
  watermarkTimeouts: number;
}

const state: OutboxMetrics = {
  backlog: 0,
  oldestUnpublishedAgeMs: null,
  tickFailures: 0,
  unprocessable: 0,
  watermarkTimeouts: 0,
};

export const outboxMetrics = {
  setBacklog(depth: number, oldestUnpublishedAgeMs: number | null): void {
    state.backlog = depth;
    state.oldestUnpublishedAgeMs = oldestUnpublishedAgeMs;
  },
  recordTickFailure(): void {
    state.tickFailures += 1;
  },
  recordUnprocessable(): void {
    state.unprocessable += 1;
  },
  recordWatermarkTimeout(rows: number): void {
    state.watermarkTimeouts += rows;
  },
  snapshot(): OutboxMetrics {
    return { ...state };
  },
  /** Tests only: the counters are process-wide. */
  reset(): void {
    state.backlog = 0;
    state.oldestUnpublishedAgeMs = null;
    state.tickFailures = 0;
    state.unprocessable = 0;
    state.watermarkTimeouts = 0;
  },
};
