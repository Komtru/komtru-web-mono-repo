// In-process queue metrics. A metrics exporter (later ticket) reads `snapshot()`.
const deadLetters = new Map<string, number>();

/** Jobs moved to a dead-letter queue, per source queue, since the process started. */
export const deadLetterCounter = {
  increment(queue: string): void {
    deadLetters.set(queue, (deadLetters.get(queue) ?? 0) + 1);
  },
  snapshot(): Record<string, number> {
    return Object.fromEntries(deadLetters);
  },
};
