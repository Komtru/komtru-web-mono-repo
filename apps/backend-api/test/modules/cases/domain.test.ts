import { describe, expect, it } from 'vitest';
import {
  ADVISORY_LABEL,
  ruleBasedAdvisory,
  type AdvisoryInput,
} from '../../../src/modules/cases/domain/advisory.js';
import {
  assertWorkable,
  stateAfterAssignment,
  stateAfterEscalation,
  stateAfterEvidenceRequested,
  stateAfterEvidenceResolved,
} from '../../../src/modules/cases/domain/lifecycle.js';
import { SLA_HOURS, slaDueAt, slaView } from '../../../src/modules/cases/domain/sla.js';
import { CASE_TYPES, caseCode } from '../../../src/modules/cases/domain/types.js';

const input = (over: Partial<AdvisoryInput> = {}): AdvisoryInput => ({
  type: 'DISPUTE',
  state: 'INVESTIGATING',
  priority: 'NORMAL',
  sla: 'ON_TRACK',
  ageHours: 3,
  openEvidenceRequests: 0,
  resolvedEvidenceRequests: 0,
  priorDecisions: 0,
  facts: {},
  ...over,
});

describe('case vocabulary', () => {
  it('prints a case number the way the console does', () => {
    expect(caseCode(2841)).toBe('C-002841');
  });
  it('has an SLA for every case type', () => {
    for (const type of CASE_TYPES) expect(SLA_HOURS[type]).toBeGreaterThan(0);
  });
});

describe('SLA clock', () => {
  const started = new Date('2026-11-07T08:00:00Z');
  const base = { state: 'INVESTIGATING' as const, slaHours: 24, dueAt: slaDueAt(started, 24) };
  it('is on track early in the window', () => {
    expect(slaView({ ...base, now: new Date('2026-11-07T10:00:00Z') }).status).toBe('ON_TRACK');
  });
  it('is at risk in the last quarter and breached past due', () => {
    expect(slaView({ ...base, now: new Date('2026-11-08T03:00:00Z') }).status).toBe('AT_RISK');
    const breached = slaView({ ...base, now: new Date('2026-11-08T09:00:00Z') });
    expect(breached.status).toBe('BREACHED');
    expect(breached.remainingMinutes).toBe(-60);
  });
  it('stops once the case is decided or closed', () => {
    for (const state of ['DECIDED', 'CLOSED'] as const) {
      expect(slaView({ ...base, state, now: new Date('2027-01-01T00:00:00Z') }).status).toBe('STOPPED');
    }
  });
});

describe('lifecycle', () => {
  it('starts work on assignment', () => {
    expect(stateAfterAssignment('OPEN')).toBe('INVESTIGATING');
    expect(stateAfterAssignment('ESCALATED')).toBe('ESCALATED');
  });
  it('refuses work on a finished case', () => {
    expect(() => assertWorkable('DECIDED')).toThrow(/already decided or closed/);
    expect(() => stateAfterEscalation('CLOSED')).toThrow();
    expect(stateAfterEscalation('OPEN')).toBe('ESCALATED');
  });
  it('parks a case on an evidence request and releases it when the last one resolves', () => {
    expect(stateAfterEvidenceRequested('INVESTIGATING')).toBe('AWAITING_EVIDENCE');
    expect(stateAfterEvidenceRequested('ESCALATED')).toBe('ESCALATED');
    expect(stateAfterEvidenceResolved('AWAITING_EVIDENCE', 1)).toBe('AWAITING_EVIDENCE');
    expect(stateAfterEvidenceResolved('AWAITING_EVIDENCE', 0)).toBe('INVESTIGATING');
    expect(stateAfterEvidenceResolved('ESCALATED', 0)).toBe('ESCALATED');
  });
});

describe('rule-based advisory (Q9 v1)', () => {
  it('always carries the label and never anything a decision has', () => {
    const advisory = ruleBasedAdvisory.suggest(input());
    expect(advisory.label).toBe(ADVISORY_LABEL);
    expect(ADVISORY_LABEL).toBe('AI-suggested — not a decision');
    expect(Object.keys(advisory).sort()).toEqual(['label', 'rationale', 'source', 'suggestion']);
  });
  it('says so when no rule matches', () => {
    const advisory = ruleBasedAdvisory.suggest(input({ type: 'KYB' }));
    expect(advisory.suggestion).toMatch(/no automated suggestion/);
    expect(advisory.rationale).toHaveLength(1);
  });
  it('waits for outstanding evidence before anything else', () => {
    const advisory = ruleBasedAdvisory.suggest(
      input({ openEvidenceRequests: 2, facts: { evidenceComplete: true } }),
    );
    expect(advisory.suggestion).toMatch(/outstanding evidence/);
    expect(advisory.rationale).toContain('2 evidence request(s) are still open');
  });
  it('suggests escalating a breached case', () => {
    expect(ruleBasedAdvisory.suggest(input({ sla: 'BREACHED' })).suggestion).toMatch(/Escalate/);
    expect(ruleBasedAdvisory.suggest(input({ sla: 'BREACHED', state: 'ESCALATED' })).suggestion).not.toMatch(
      /Escalate to a senior reviewer/,
    );
  });
  it.each([
    ['DISPUTE', { counterpartyResponded: false }, /counterparty/],
    ['DISPUTE', { evidenceComplete: true }, /Compare both sides/],
    ['KYB', { documentsComplete: false }, /missing business documents/],
    ['KYB', { registryMatch: false }, /registry mismatch/],
    ['MERCHANT_APPLICATION', { checklistComplete: false }, /checklist/],
    ['IDENTITY', { nameMatch: false }, /identity document/],
    ['IDENTITY', { livenessPassed: false }, /liveness/],
    ['FRAUD', { signalCount: 4 }, /senior fraud analyst/],
    ['FRAUD', { signalCount: 1 }, /Review the attached signals/],
    ['CUSTODY', { heldHours: 52 }, /hub operator/],
    ['PAYMENT_EXCEPTION', { ledgerMismatch: true }, /finance/],
    ['TRADE_PROPOSAL', { riskHold: true }, /history/],
    ['PARK_HUB_APPLICATION', { siteVisitDone: false }, /site audit/],
  ] as const)('%s with %j', (type, facts, expected) => {
    expect(ruleBasedAdvisory.suggest(input({ type, facts })).suggestion).toMatch(expected);
  });
});
