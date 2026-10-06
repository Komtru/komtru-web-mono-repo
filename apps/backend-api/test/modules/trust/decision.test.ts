// What a provider's verdict means for the request, and what a user has earned. Both are pure, and
// both are decisions the spec makes rather than ones the code is free to invent.
import { describe, expect, it } from 'vitest';
import { decideIdentityOutcome, decideLivenessOutcome } from '../../../src/modules/trust/domain/decision.js';
import {
  LEVEL_NAMES,
  earnedIdentityLevel,
  levelName,
  levelNumber,
} from '../../../src/modules/trust/domain/levels.js';

describe('decideIdentityOutcome', () => {
  it('approves a pass and stamps the outcome verified', () => {
    expect(decideIdentityOutcome('PASSED')).toEqual({
      requestStatus: 'APPROVED',
      markVerified: true,
      terminal: true,
    });
  });

  it('sends a low-confidence result to a human, and does NOT stamp it verified', () => {
    // Leaving verified_at null is what keeps the partial unique index from claiming the number for
    // an account no one has approved yet.
    expect(decideIdentityOutcome('LOW_CONFIDENCE')).toEqual({
      requestStatus: 'MANUAL_REVIEW',
      markVerified: false,
      terminal: false,
    });
  });

  it('rejects a failure terminally', () => {
    expect(decideIdentityOutcome('FAILED')).toEqual({
      requestStatus: 'REJECTED',
      markVerified: false,
      terminal: true,
    });
  });

  it('leaves a pending verdict pending, for the sweep rather than a decision', () => {
    expect(decideIdentityOutcome('PENDING')).toEqual({
      requestStatus: 'PROVIDER_PENDING',
      markVerified: false,
      terminal: false,
    });
  });
});

describe('decideLivenessOutcome', () => {
  it('approves only a verdict that actually passed liveness', () => {
    expect(decideLivenessOutcome('PASSED', true).requestStatus).toBe('APPROVED');
  });

  it('refuses to approve a PASSED verdict whose liveness flag says otherwise', () => {
    // Belt and braces against an adapter whose two fields disagree: the boolean is the claim that
    // matters, and "the provider said PASSED" is not a reason to grant a level on a failed selfie.
    expect(decideLivenessOutcome('PASSED', false).requestStatus).toBe('REJECTED');
  });

  it('sends a weak match to review rather than rejecting it', () => {
    expect(decideLivenessOutcome('LOW_CONFIDENCE', false).requestStatus).toBe('MANUAL_REVIEW');
  });
});

describe('levels', () => {
  it('indexes the M6 §4 ladder by its numeric level', () => {
    expect(LEVEL_NAMES[0]).toBe('UNVERIFIED');
    expect(LEVEL_NAMES[1]).toBe('CONTACT_VERIFIED');
    expect(LEVEL_NAMES[2]).toBe('IDENTITY_VERIFIED');
    expect(LEVEL_NAMES[3]).toBe('BUSINESS_VERIFIED');
    expect(LEVEL_NAMES[4]).toBe('ENHANCED');
  });

  it('round-trips a name and a number', () => {
    expect(levelName(levelNumber('IDENTITY_VERIFIED'))).toBe('IDENTITY_VERIFIED');
  });

  it('refuses a level name it does not know, rather than guessing zero', () => {
    expect(() => levelNumber('SOMETHING_ELSE')).toThrow(/SOMETHING_ELSE/);
  });

  it('needs an identifier AND liveness for level 2', () => {
    expect(earnedIdentityLevel({ identifierVerified: true, livenessPassed: false })).toBe(false);
    expect(earnedIdentityLevel({ identifierVerified: false, livenessPassed: true })).toBe(false);
    expect(earnedIdentityLevel({ identifierVerified: true, livenessPassed: true })).toBe(true);
  });
});
