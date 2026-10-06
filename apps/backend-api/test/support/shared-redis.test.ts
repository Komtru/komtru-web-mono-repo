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
import { testKeyPrefix, testQueuePrefix } from './db-urls.js';

const TEST_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
// The one file that must NOT carry a namespace: its job is asserting what loadConfig defaults to.
const CONFIG_DEFAULTS_TEST = join(TEST_ROOT, 'config', 'env.test.ts');

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

  // The constructors above are not the only way in: a test that hands an env to startApi, startWorker
  // or loadConfig gets its namespace from that object, and omitting it silently falls back to the
  // production one. That is how T-027's two socket files ended up fanning out to each other's
  // sockets through one `komtru:sock:` channel set, which the constructor check could not see.
  it('names the namespace in every env a test builds', () => {
    const offenders = testFiles(TEST_ROOT)
      .filter((path) => path !== SELF && path !== CONFIG_DEFAULTS_TEST)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        // Either helper carries the namespace: `testProcessEnv` is `testRedisEnv` plus a pool cap,
        // for the suites that start a real API or worker.
        return (
          source.includes('REDIS_URL: testRedisUrl()') &&
          !source.includes('...testRedisEnv()') &&
          !source.includes('...testProcessEnv()')
        );
      });
    expect(offenders.map((path) => path.slice(TEST_ROOT.length))).toEqual([]);
  });

  // T-032 made the identity module refuse to build without a pepper, and every process-starting
  // test builds that module. A harness that sets a signing key but no pepper therefore fails at
  // startApi, several frames from the env object that actually omitted it.
  it('pairs a signing key with a pepper in every env that has one', () => {
    const offenders = testFiles(TEST_ROOT)
      .filter((path) => path !== SELF)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        // Minting a fresh key is the signature of building a whole app env, as opposed to
        // overriding one field of a config a helper already built; and only a file that goes on to
        // build the module registry can hit the refusal. A signer-only unit test needs no pepper.
        return (
          /IDENTITY_SIGNING_KEY: randomBytes\(/.test(source) &&
          /startApi|startWorker|createModules|createIdentityAuth|createSocketModule/.test(source) &&
          !source.includes('IDENTITY_HMAC_PEPPER')
        );
      });
    expect(offenders.map((path) => path.slice(TEST_ROOT.length))).toEqual([]);
  });

  // The whole scheme rests on the global setup's run id reaching the worker processes. If it ever
  // stops propagating, every namespace silently falls back to one shared name and the isolation is
  // gone with no other symptom — so assert the mechanism, not just the intent.
  it('carries a run id, so one run cannot inherit another run\u2019s queues', () => {
    expect(process.env.KOMTRU_TEST_RUN_ID).toBeTruthy();
    expect(testQueuePrefix()).not.toContain('norun');
    expect(testKeyPrefix()).not.toContain('norun');
  });

  it('is never flushed wholesale by a test', () => {
    const offenders = testFiles(TEST_ROOT)
      // This file names the call it bans, in the comment above and in the pattern below.
      .filter((path) => path !== SELF)
      .filter((path) => /\b(flushdb|flushall)\s*\(/i.test(readFileSync(path, 'utf8')));
    expect(offenders.map((path) => path.slice(TEST_ROOT.length))).toEqual([]);
  });
});
