// Vitest runs test files in parallel against one Redis logical database, so its keyspace is shared
// mutable state: BullMQ queues, rate-limit counters and idempotency records all live there at once.
// A `flushdb()` in one file's teardown therefore deletes another file's in-flight job, and the
// symptom lands nowhere near the cause — a notification stuck at QUEUED, with an empty queue and a
// provider that was never called, in a file that did nothing wrong.
//
// T-031 shipped four of these and cost an afternoon. Nothing needs them: every key a test writes is
// namespaced by a uuid it just generated and carries its own TTL.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const testFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.(ts|mts)$/.test(entry) ? [path] : [];
  });

describe('the shared test Redis database', () => {
  it('is never flushed wholesale by a test', () => {
    const offenders = testFiles(TEST_ROOT)
      // This file names the call it bans, in the comment above and in the pattern below.
      .filter((path) => path !== SELF)
      .filter((path) => /\b(flushdb|flushall)\s*\(/i.test(readFileSync(path, 'utf8')));
    expect(offenders.map((path) => path.slice(TEST_ROOT.length))).toEqual([]);
  });
});
