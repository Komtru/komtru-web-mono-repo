// The MERCHANT_APPLICATION advisory (T-055): rules over the evidence facts, a suggestion for a person and
// never a decision.
import { describe, expect, it } from 'vitest';
import {
  ADVISORY_LABEL,
  ruleBasedAdvisory,
  type AdvisoryInput,
} from '../../../src/modules/cases/domain/advisory.js';

const advise = (facts: AdvisoryInput['facts']) =>
  ruleBasedAdvisory.suggest({
    type: 'MERCHANT_APPLICATION',
    state: 'INVESTIGATING',
    priority: 'NORMAL',
    sla: 'ON_TRACK',
    ageHours: 2,
    openEvidenceRequests: 0,
    resolvedEvidenceRequests: 0,
    priorDecisions: 0,
    facts,
  });

const whole = {
  checklistComplete: true,
  identityVerified: true,
  cacLookup: 'VERIFIED',
  bankNameMatch: 'EXACT',
};

describe('the merchant application advisory', () => {
  it('is always labelled as a suggestion', () => {
    expect(advise(whole).label).toBe(ADVISORY_LABEL);
  });

  it('suggests a review, not an approval, when every check is clean', () => {
    const advisory = advise(whole);
    expect(advisory.suggestion).toBe('Review the checklist and decide');
    expect(advisory.suggestion).not.toMatch(/approve/i);
  });

  it('asks for the missing items first when the checklist is incomplete', () => {
    expect(advise({ ...whole, checklistComplete: false }).suggestion).toMatch(/missing items/);
  });

  it('suggests waiting while the applicant has not verified their identity', () => {
    const advisory = advise({ ...whole, identityVerified: false });
    expect(advisory.suggestion).toMatch(/identity/i);
    expect(advisory.rationale.join(' ')).toMatch(/identity verification/);
  });

  it('suggests asking about the CAC details when the lookup did not verify the business', () => {
    expect(advise({ ...whole, cacLookup: 'FAILED' }).suggestion).toMatch(/CAC/);
  });

  it('suggests a payout account in the business name on a name mismatch', () => {
    const advisory = advise({ ...whole, bankNameMatch: 'MISMATCH' });
    expect(advisory.suggestion).toMatch(/payout account/);
  });

  it('lists every reason that matched, not only the first', () => {
    const advisory = advise({ ...whole, cacLookup: 'FAILED', bankNameMatch: 'MISMATCH' });
    expect(advisory.rationale.length).toBeGreaterThanOrEqual(3);
  });

  it('carries no outcome, reason or citation member that could be stored as a decision', () => {
    expect(Object.keys(advise(whole)).sort()).toEqual(['label', 'rationale', 'source', 'suggestion']);
  });
});
