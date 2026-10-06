import { describe, expect, it } from 'vitest';
import {
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
});
