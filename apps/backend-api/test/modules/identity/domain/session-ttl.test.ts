import { describe, expect, it } from 'vitest';
import {
  nextLagosMidnight,
  SESSION_TTLS,
  sessionExpiry,
  slidingIdleExpiry,
} from '../../../../src/modules/identity/domain/session/ttl.js';

describe('session TTLs', () => {
  it('gives staff a 30-minute idle and an 8-hour absolute window (M1 C3)', () => {
    expect(SESSION_TTLS.STAFF).toEqual({ idleSeconds: 1_800, absoluteSeconds: 28_800 });
  });

  it('gives consumer and logistics the same 30-day sliding window', () => {
    expect(SESSION_TTLS.CONSUMER.idleSeconds).toBe(30 * 24 * 60 * 60);
    expect(SESSION_TTLS.LOGISTICS).toEqual(SESSION_TTLS.CONSUMER);
  });

  it('computes both expiries from one now', () => {
    const now = new Date('2026-10-05T00:00:00.000Z');
    expect(sessionExpiry('STAFF', now)).toEqual({
      idleExpiresAt: new Date('2026-10-05T00:30:00.000Z'),
      absoluteExpiresAt: new Date('2026-10-05T08:00:00.000Z'),
    });
  });

  it('slides the idle deadline from now, which is what a rotation extends', () => {
    const now = new Date('2026-10-05T00:00:00.000Z');
    expect(slidingIdleExpiry('STAFF', now)).toEqual(new Date('2026-10-05T00:30:00.000Z'));
  });

  it('never lets the idle window outlast the absolute one', () => {
    for (const ttl of Object.values(SESSION_TTLS)) {
      expect(ttl.idleSeconds).toBeLessThanOrEqual(ttl.absoluteSeconds);
    }
  });

  // Owner ruling 2026-11-22: a consumer or logistics sign-in ends at midnight in Lagos (UTC+1, no DST).
  describe('the consumer sign-in ends at Lagos midnight', () => {
    it('finds the end of the Lagos day, which is 23:00 UTC', () => {
      expect(nextLagosMidnight(new Date('2026-11-22T09:15:00.000Z'))).toEqual(
        new Date('2026-11-22T23:00:00.000Z'),
      );
    });

    it('counts 23:30 UTC as the next Lagos day already', () => {
      expect(nextLagosMidnight(new Date('2026-11-22T23:30:00.000Z'))).toEqual(
        new Date('2026-11-23T23:00:00.000Z'),
      );
    });

    it('gives a sign-in at exactly Lagos midnight the whole of the new day', () => {
      expect(nextLagosMidnight(new Date('2026-11-22T23:00:00.000Z'))).toEqual(
        new Date('2026-11-23T23:00:00.000Z'),
      );
    });

    it('crosses a month and a year end', () => {
      expect(nextLagosMidnight(new Date('2026-12-31T20:00:00.000Z'))).toEqual(
        new Date('2026-12-31T23:00:00.000Z'),
      );
    });

    it('sets the consumer and logistics absolute deadline to that midnight, and leaves staff at 8 hours', () => {
      const now = new Date('2026-11-22T09:15:00.000Z');
      expect(sessionExpiry('CONSUMER', now).absoluteExpiresAt).toEqual(new Date('2026-11-22T23:00:00.000Z'));
      expect(sessionExpiry('LOGISTICS', now).absoluteExpiresAt).toEqual(new Date('2026-11-22T23:00:00.000Z'));
      expect(sessionExpiry('STAFF', now).absoluteExpiresAt).toEqual(new Date('2026-11-22T17:15:00.000Z'));
    });
  });
});
