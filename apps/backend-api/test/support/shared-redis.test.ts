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

/** The full text of each `fn(...)` call, parens balanced — a regex stops at the first nested `)`. */
const callsTo = (source: string, fn: string): string[] => {
  const calls: string[] = [];
  for (let at = source.indexOf(`${fn}(`); at !== -1; at = source.indexOf(`${fn}(`, at + 1)) {
    let depth = 0;
    for (let i = at + fn.length; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(at, i + 1));
          break;
        }
      }
    }
  }
  return calls;
};

describe('the shared test Redis database', () => {
  // Every key a test writes has to land in that worker's own namespace, or the test is back to
  // sharing one keyspace with the dozen files running beside it. Both constructors take the
  // namespace explicitly so that forgetting it is visible here rather than as a flake somewhere else.
  it('is only ever reached through an explicit namespace', () => {
    const offenders: string[] = [];
    for (const path of testFiles(TEST_ROOT)) {
      if (path === SELF) continue;
      const source = readFileSync(path, 'utf8');
      for (const [fn, option] of [
        ['createRedis', 'keyPrefix'],
        ['createQueueFactory', 'prefix'],
      ] as const)
        for (const call of callsTo(source, fn))
          if (!call.includes(`${option}:`)) offenders.push(`${path.slice(TEST_ROOT.length)}: ${fn}`);
    }
    expect(offenders).toEqual([]);
  });

  it('is never flushed wholesale by a test', () => {
    const offenders = testFiles(TEST_ROOT)
      // This file names the call it bans, in the comment above and in the pattern below.
      .filter((path) => path !== SELF)
      .filter((path) => /\b(flushdb|flushall)\s*\(/i.test(readFileSync(path, 'utf8')));
    expect(offenders.map((path) => path.slice(TEST_ROOT.length))).toEqual([]);
  });
});
