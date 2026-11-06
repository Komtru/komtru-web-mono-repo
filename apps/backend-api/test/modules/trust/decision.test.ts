// What a provider's verdict means for the request, and what a user has earned. Both are pure, and
// both are decisions the spec makes rather than ones the code is free to invent.
import { describe, expect, it } from 'vitest';
import {
  classifyBankMatchFailure,
  classifyBusinessFailure,
  decideBankMatchOutcome,
  decideBusinessOutcome,
  decideIdentityOutcome,
  decideLivenessOutcome,
} from '../../../src/modules/trust/domain/decision.js';
import {
  LEVEL_NAMES,
  earnedBusinessLevel,
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

describe('decideBusinessOutcome', () => {
  const found = {
    verdict: 'PASSED' as const,
    providerReference: 'r',
    registeredBusinessName: 'FAKE ENTERPRISES 1 LIMITED',
  };

  it('approves a registration that is real, active and the submitter’s', () => {
    expect(decideBusinessOutcome({ ...found, cacStatus: 'active', officersMatch: true })).toEqual({
      requestStatus: 'APPROVED',
      markVerified: true,
      terminal: true,
    });
  });

  it('refuses a real but inactive registration, which a verdict-only switch would have approved', () => {
    expect(decideBusinessOutcome({ ...found, cacStatus: 'inactive', officersMatch: true })).toMatchObject({
      requestStatus: 'REJECTED',
      markVerified: false,
    });
  });

  it('refuses a registration the submitter is not an officer of', () => {
    expect(decideBusinessOutcome({ ...found, cacStatus: 'active', officersMatch: false })).toMatchObject({
      requestStatus: 'REJECTED',
    });
  });

  /** §8 is honest that officer data is implied rather than confirmed across this vendor space. */
  it('sends an unknown officer answer to a human rather than refusing every quiet provider', () => {
    expect(decideBusinessOutcome({ ...found, cacStatus: 'active' })).toMatchObject({
      requestStatus: 'MANUAL_REVIEW',
      markVerified: false,
    });
  });
});

describe('classifyBusinessFailure', () => {
  it('prefers the adapter’s own code, which is the only thing that knows the vendor', () => {
    expect(
      classifyBusinessFailure({ verdict: 'FAILED', providerReference: 'r', failureCode: 'CAC_INACTIVE' }),
    ).toBe('CAC_INACTIVE');
  });

  it('calls a missing registration missing', () => {
    expect(classifyBusinessFailure({ verdict: 'FAILED', providerReference: 'r' })).toBe('CAC_NOT_FOUND');
  });

  it('does NOT call an active registration inactive', () => {
    expect(
      classifyBusinessFailure({
        verdict: 'PASSED',
        providerReference: 'r',
        cacStatus: 'active',
        officersMatch: false,
      }),
    ).toBe('CAC_OFFICER_MISMATCH');
  });

  /**
   * The one that mattered: a registration parked for review because the registry was silent on its
   * officers used to classify as CAC_NOT_FOUND, so BVR1 told the seller their number matched nothing
   * — of a number that matched — and offered a resubmit where a person was already looking.
   */
  it('calls an officers-unknown registration a review case, not a missing one', () => {
    expect(classifyBusinessFailure({ verdict: 'PASSED', providerReference: 'r', cacStatus: 'active' })).toBe(
      'NEEDS_HUMAN_REVIEW',
    );
  });

  it('calls a genuinely inactive registration inactive', () => {
    expect(
      classifyBusinessFailure({ verdict: 'PASSED', providerReference: 'r', cacStatus: 'inactive' }),
    ).toBe('CAC_INACTIVE');
  });
});

describe('decideBankMatchOutcome and classifyBankMatchFailure', () => {
  it('approves only an EXACT match on a PASSED verdict', () => {
    expect(
      decideBankMatchOutcome({ verdict: 'PASSED', providerReference: 'r', matchResult: 'EXACT' }),
    ).toMatchObject({ requestStatus: 'APPROVED', markVerified: true });
  });

  /** Both errors are expensive here and only one of them is reversible. */
  it('does not treat FUZZY_MATCH as a pass', () => {
    expect(
      decideBankMatchOutcome({ verdict: 'PASSED', providerReference: 'r', matchResult: 'FUZZY_MATCH' }),
    ).toMatchObject({ requestStatus: 'MANUAL_REVIEW', markVerified: false });
  });

  it('tells an account the bank does not know from one held in another name', () => {
    expect(
      classifyBankMatchFailure({ verdict: 'FAILED', providerReference: 'r', matchResult: 'MISMATCH' }),
    ).toBe('BANK_ACCOUNT_NOT_FOUND');
    expect(
      classifyBankMatchFailure({
        verdict: 'FAILED',
        providerReference: 'r',
        matchResult: 'MISMATCH',
        resolvedAccountName: 'SOMEBODY ELSE',
      }),
    ).toBe('BANK_NAME_MISMATCH');
  });
});

describe('earnedBusinessLevel', () => {
  /** The ticket, verbatim: "Level 3 requires level 2 plus CAC plus business bank match." */
  it('wants all three, and says no to every pair', () => {
    expect(earnedBusinessLevel({ currentLevel: 2, cacVerified: true, businessBankMatched: true })).toBe(true);
    expect(earnedBusinessLevel({ currentLevel: 1, cacVerified: true, businessBankMatched: true })).toBe(
      false,
    );
    expect(earnedBusinessLevel({ currentLevel: 2, cacVerified: false, businessBankMatched: true })).toBe(
      false,
    );
    expect(earnedBusinessLevel({ currentLevel: 2, cacVerified: true, businessBankMatched: false })).toBe(
      false,
    );
  });

  it('still says yes to a user already above level 2', () => {
    expect(earnedBusinessLevel({ currentLevel: 4, cacVerified: true, businessBankMatched: true })).toBe(true);
  });
});
