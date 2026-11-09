// T-052's pure rules: which case type a request becomes, what the advisory is told, which overrides
// are allowed at all, and when the repeated-rejection event fires.
import { describe, expect, it } from 'vitest';
import {
  REPEATED_REJECTION_THRESHOLD,
  REPEATED_REJECTION_WINDOW_DAYS,
  assertOverrideAllowed,
  caseTypeFor,
  isRepeatedRejection,
  reviewFacts,
} from '../../../src/modules/trust/domain/review.js';
import { describeRejection, isRejectionCode } from '../../../src/modules/trust/domain/rejection.js';
import { ruleBasedAdvisory } from '../../../src/modules/cases/domain/advisory.js';
import { VERIFICATION_TYPES } from '../../../src/modules/trust/infrastructure/postgres/schema/enums.js';

describe('which case a parked request becomes', () => {
  it('sends the business half to KYB and every other type to IDENTITY', () => {
    expect(caseTypeFor('CAC')).toBe('KYB');
    expect(caseTypeFor('BANK_ACCOUNT_NAME_MATCH')).toBe('KYB');
    for (const type of VERIFICATION_TYPES.filter((t) => t !== 'CAC' && t !== 'BANK_ACCOUNT_NAME_MATCH')) {
      expect(caseTypeFor(type)).toBe('IDENTITY');
    }
  });
});

describe('the facts the advisory reads', () => {
  it('holds scalars only and marks a duplicate', () => {
    const facts = reviewFacts({ verificationType: 'NIN', reason: 'DUPLICATE_IDENTITY', attemptCount: 2 });
    expect(facts).toMatchObject({ duplicateIdentity: true, attemptCount: 2, verificationType: 'NIN' });
    for (const value of Object.values(facts)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });

  it('gives the advisory a duplicate suggestion that is never an approval', () => {
    for (const [type, verificationType] of [
      ['IDENTITY', 'NIN'],
      ['KYB', 'CAC'],
    ] as const) {
      const advisory = ruleBasedAdvisory.suggest({
        type,
        state: 'OPEN',
        priority: 'HIGH',
        sla: 'ON_TRACK',
        ageHours: 1,
        openEvidenceRequests: 0,
        resolvedEvidenceRequests: 0,
        priorDecisions: 0,
        facts: reviewFacts({ verificationType, reason: 'DUPLICATE_IDENTITY', attemptCount: 1 }),
      } as never);
      expect(advisory.label).toBe('AI-suggested — not a decision');
      expect(advisory.suggestion).not.toMatch(/^approve/i);
      expect(advisory.rationale.join(' ')).toMatch(/another account/i);
    }
  });
});

describe('verification.override bounds', () => {
  it('grants only level 2 or 3, and only upwards', () => {
    expect(() => assertOverrideAllowed({ direction: 'GRANT', toLevel: 2, currentLevel: 1 })).not.toThrow();
    expect(() => assertOverrideAllowed({ direction: 'GRANT', toLevel: 3, currentLevel: 2 })).not.toThrow();
    expect(() => assertOverrideAllowed({ direction: 'GRANT', toLevel: 4, currentLevel: 3 })).toThrow(
      /level 4/i,
    );
    expect(() => assertOverrideAllowed({ direction: 'GRANT', toLevel: 2, currentLevel: 3 })).toThrow(
      /higher/,
    );
  });

  it('revokes only downwards and never below level 1', () => {
    expect(() => assertOverrideAllowed({ direction: 'REVOKE', toLevel: 1, currentLevel: 3 })).not.toThrow();
    expect(() => assertOverrideAllowed({ direction: 'REVOKE', toLevel: 0, currentLevel: 3 })).toThrow(
      /level 1/i,
    );
    expect(() => assertOverrideAllowed({ direction: 'REVOKE', toLevel: 3, currentLevel: 2 })).toThrow(
      /lower/,
    );
  });
});

describe('two rejections in 30 days', () => {
  it('names the threshold and the window', () => {
    expect(REPEATED_REJECTION_THRESHOLD).toBe(2);
    expect(REPEATED_REJECTION_WINDOW_DAYS).toBe(30);
  });

  it('fires when the count has just reached the threshold and not on the first or third', () => {
    expect(isRepeatedRejection(1)).toBe(false);
    expect(isRepeatedRejection(2)).toBe(true);
    expect(isRepeatedRejection(3)).toBe(false);
  });
});

describe('the new rejection codes', () => {
  it('are described for the screens', () => {
    for (const code of ['DUPLICATE_IDENTITY', 'REVIEW_DECLINED']) {
      expect(isRejectionCode(code)).toBe(true);
      expect(describeRejection(code).code).toBe(code);
    }
  });
});
