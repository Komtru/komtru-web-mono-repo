import { describe, expect, it } from 'vitest';
import { decideDelivery, rateLimitWindowStart } from '../../../../src/modules/notify/domain/decide.js';

const input = (overrides: Partial<Parameters<typeof decideDelivery>[0]> = {}) => ({
  securityCritical: false,
  category: 'TRADE' as const,
  hasDestination: true,
  optedIn: true,
  sendCountInWindow: 0,
  maxPerWindow: 20,
  ...overrides,
});

describe('decideDelivery', () => {
  it('sends an opted-in notification under the cap', () => {
    expect(decideDelivery(input())).toEqual({ kind: 'SEND' });
  });

  it('suppresses a non-critical notification the user opted out of', () => {
    expect(decideDelivery(input({ optedIn: false }))).toEqual({
      kind: 'SUPPRESS',
      reason: 'PREFERENCE_OPT_OUT',
    });
  });

  it('sends a security-critical notification although the user opted out', () => {
    expect(decideDelivery(input({ securityCritical: true, category: 'SECURITY', optedIn: false }))).toEqual({
      kind: 'SEND',
    });
  });

  it('suppresses a non-critical notification over the cap', () => {
    expect(decideDelivery(input({ sendCountInWindow: 20 }))).toEqual({
      kind: 'SUPPRESS',
      reason: 'RATE_LIMITED',
    });
  });

  it('sends a security-critical notification although the user is over the cap', () => {
    expect(
      decideDelivery(input({ securityCritical: true, category: 'SECURITY', sendCountInWindow: 999 })),
    ).toEqual({ kind: 'SEND' });
  });

  it('never rate-limits the SECURITY category, even if a template forgot the flag', () => {
    expect(decideDelivery(input({ category: 'SECURITY', sendCountInWindow: 999 }))).toEqual({
      kind: 'SEND',
    });
  });

  it('still honours an opt-out for a SECURITY-category template that is not security critical', () => {
    // Belt and braces: assertCatalogueIntegrity makes this combination impossible to ship, and the
    // preferences endpoint refuses to store a SECURITY opt-out, so this can only come from a row
    // written before either guard existed.
    expect(decideDelivery(input({ category: 'SECURITY', optedIn: false }))).toEqual({
      kind: 'SUPPRESS',
      reason: 'PREFERENCE_OPT_OUT',
    });
  });

  it('suppresses a non-critical notification with nowhere to send it', () => {
    expect(decideDelivery(input({ hasDestination: false }))).toEqual({
      kind: 'SUPPRESS',
      reason: 'NO_DESTINATION',
    });
  });

  it('escalates a security-critical notification with nowhere to send it', () => {
    expect(decideDelivery(input({ securityCritical: true, hasDestination: false }))).toEqual({
      kind: 'UNDELIVERABLE',
    });
  });

  it('admits exactly maxPerWindow sends', () => {
    expect(decideDelivery(input({ sendCountInWindow: 19 }))).toEqual({ kind: 'SEND' });
  });
});

describe('rateLimitWindowStart', () => {
  it('puts two sends an hour apart in the same hourly window when they share it', () => {
    expect(rateLimitWindowStart(new Date('2026-10-05T10:01:00Z'), 60)).toEqual(
      rateLimitWindowStart(new Date('2026-10-05T10:59:59Z'), 60),
    );
  });

  it('starts a new window on the hour', () => {
    expect(rateLimitWindowStart(new Date('2026-10-05T11:00:00Z'), 60)).toEqual(
      new Date('2026-10-05T11:00:00Z'),
    );
    expect(rateLimitWindowStart(new Date('2026-10-05T10:59:59Z'), 60)).toEqual(
      new Date('2026-10-05T10:00:00Z'),
    );
  });

  it('handles a window that does not divide an hour', () => {
    // Floored on the epoch, not within the hour, so the windows tile without a gap at :00.
    expect(rateLimitWindowStart(new Date('2026-10-05T10:14:00Z'), 7)).toEqual(
      new Date('2026-10-05T10:10:00Z'),
    );
  });
});
