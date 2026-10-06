// The expiry boundary on its own: no Postgres, no Redis, no clock race.
//
// `idempotency.int.test.ts > runs again once a stored record is past its lifetime` failed about one
// run in three (T-029). It builds the gate with `ttlHours: 0` and fires two requests, expecting the
// second to re-run the handler. The gate decided with `Date.now() - completedAt.getTime() > 0`, and
// `getTime()` truncates the timestamptz to milliseconds — so whenever both requests landed inside
// one millisecond the age came out as exactly 0, the record read as live, and the second request
// replayed the first instead of re-running it.
import { describe, expect, it } from 'vitest';
import { IDEMPOTENCY_TTL_HOURS, isExpired } from '../../../src/platform/http/idempotency.js';

const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

describe('isExpired', () => {
  it('never expires a record that has not completed', () => {
    expect(isExpired(null, 0, NOW)).toBe(false);
    expect(isExpired(null, IDEMPOTENCY_TTL_HOURS, NOW)).toBe(false);
  });

  // The regression. A ttl of 0 means "spent the moment it completed", so an age of exactly 0 counts
  // as expired; this is the case the integration test hit whenever its two requests shared a
  // millisecond.
  it('treats a ttl of 0 as expired at an age of exactly zero', () => {
    expect(isExpired(new Date(NOW), 0, NOW)).toBe(true);
  });

  it('expires a record once it is at least ttlHours old', () => {
    expect(isExpired(new Date(NOW - 24 * HOUR_MS), 24, NOW)).toBe(true);
    expect(isExpired(new Date(NOW - 25 * HOUR_MS), 24, NOW)).toBe(true);
  });

  it('keeps a record live until it reaches ttlHours', () => {
    expect(isExpired(new Date(NOW), 24, NOW)).toBe(false);
    expect(isExpired(new Date(NOW - 23 * HOUR_MS), 24, NOW)).toBe(false);
    expect(isExpired(new Date(NOW - (24 * HOUR_MS - 1)), 24, NOW)).toBe(false);
  });

  // The boundary is inclusive on both sides of the gate: the Postgres retake predicate uses `<=`
  // for the same reason, so the two can never disagree about a record sitting exactly on it. They
  // disagreeing is what sends a request into the mid-flight poll and then a spurious 409.
  it('agrees with the retake predicate at the boundary', () => {
    expect(isExpired(new Date(NOW - 24 * HOUR_MS), 24, NOW)).toBe(true);
  });
});
