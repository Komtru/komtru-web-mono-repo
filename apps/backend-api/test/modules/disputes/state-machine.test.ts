// T-080's state machine, as a pure table. M3 §3 with C13's `MEDIATION` prepended: a dispute now
// opens into a 48-hour window the parties own, and only reaches a reviewer if they do not settle it
// themselves. Everything here runs without Postgres, Redis or a clock.
import { describe, expect, it } from 'vitest';
import {
  DISPUTE_ACTIONS,
  DISPUTE_STATUSES,
  TERMINAL_STATUSES,
  canTransition,
  isTerminal,
  isTransitionAllowed,
  sourceStatuses,
  transitionTriples,
} from '../../../src/modules/disputes/domain/stateMachine.js';
import { DECISION_OUTCOMES, disputeCode } from '../../../src/modules/disputes/domain/types.js';

describe('the opening state', () => {
  it('opens into mediation, never straight into evidence collection', () => {
    expect(isTransitionAllowed('OPEN', 'MEDIATION', 'MEDIATION')).toBe(false);
    // Nothing transitions INTO the opening state: a case is created there.
    expect(sourceStatuses('OPEN', 'MEDIATION')).toEqual([]);
    expect(isTransitionAllowed('MEDIATION_LAPSED', 'MEDIATION', 'OPEN_EVIDENCE_COLLECTION')).toBe(true);
  });

  it('lets an agreed mediation skip review and resolve', () => {
    expect(isTransitionAllowed('AGREE', 'MEDIATION', 'DECIDED')).toBe(true);
    expect(isTransitionAllowed('AGREE', 'UNDER_REVIEW', 'DECIDED')).toBe(false);
    expect(isTransitionAllowed('AGREE', 'OPEN_EVIDENCE_COLLECTION', 'DECIDED')).toBe(false);
  });

  it('lets the person who opened it withdraw, but only during mediation (SP-M23)', () => {
    expect(isTransitionAllowed('WITHDRAW', 'MEDIATION', 'CLOSED')).toBe(true);
    expect(canTransition('WITHDRAW', 'UNDER_REVIEW')).toEqual([]);
    expect(canTransition('WITHDRAW', 'DECIDED')).toEqual([]);
  });
});

describe('evidence and review', () => {
  it('closes the evidence window into review', () => {
    expect(isTransitionAllowed('CLOSE_EVIDENCE', 'OPEN_EVIDENCE_COLLECTION', 'UNDER_REVIEW')).toBe(true);
  });

  it('only a reviewer reopens collection, and only from review (M3 D2)', () => {
    expect(isTransitionAllowed('REOPEN_EVIDENCE', 'UNDER_REVIEW', 'OPEN_EVIDENCE_COLLECTION')).toBe(true);
    expect(canTransition('REOPEN_EVIDENCE', 'DECIDED')).toEqual([]);
    expect(canTransition('REOPEN_EVIDENCE', 'CLOSED')).toEqual([]);
  });

  it('records a decision out of review', () => {
    expect(isTransitionAllowed('DECIDE', 'UNDER_REVIEW', 'DECIDED')).toBe(true);
    expect(canTransition('DECIDE', 'MEDIATION')).toEqual([]);
  });
});

describe('appeals (M3 D5)', () => {
  it('allows an appeal only from a decided case', () => {
    expect(isTransitionAllowed('APPEAL', 'DECIDED', 'APPEALED')).toBe(true);
    expect(canTransition('APPEAL', 'CLOSED')).toEqual([]);
    expect(canTransition('APPEAL', 'APPEALED')).toEqual([]);
    expect(canTransition('APPEAL', 'APPEAL_UNDER_REVIEW')).toEqual([]);
  });

  it('routes an appeal through a lead and ends at CLOSED, with no second appeal', () => {
    expect(isTransitionAllowed('ASSIGN_APPEAL', 'APPEALED', 'APPEAL_UNDER_REVIEW')).toBe(true);
    expect(isTransitionAllowed('DECIDE_APPEAL', 'APPEAL_UNDER_REVIEW', 'CLOSED')).toBe(true);
    expect(canTransition('DECIDE_APPEAL', 'CLOSED')).toEqual([]);
  });

  it('closes an unappealed decision when its window lapses', () => {
    expect(isTransitionAllowed('LAPSE', 'DECIDED', 'CLOSED')).toBe(true);
  });
});

describe('the table as a whole', () => {
  it('has exactly one terminal state, CLOSED', () => {
    expect([...TERMINAL_STATUSES]).toEqual(['CLOSED']);
    expect(isTerminal('CLOSED')).toBe(true);
    expect(isTerminal('DECIDED')).toBe(false);
  });

  it('can reach CLOSED from every non-terminal state', () => {
    const reaches = new Set<string>(['CLOSED']);
    // Walk backwards over the edges until the set stops growing.
    for (let size = 0; size !== reaches.size;) {
      size = reaches.size;
      for (const [action, from, to] of transitionTriples()) {
        void action;
        if (reaches.has(to)) reaches.add(from);
      }
    }
    expect([...DISPUTE_STATUSES].filter((status) => !reaches.has(status))).toEqual([]);
  });

  it('gives every action an edge except OPEN, which creates the case', () => {
    const used = new Set(transitionTriples().map(([action]) => action));
    // `OPEN` is in the vocabulary so the status-change log can name the opening, but a case is
    // created in MEDIATION rather than moved into it, so it is the one action with no edges.
    expect([...DISPUTE_ACTIONS].filter((action) => !used.has(action))).toEqual(['OPEN']);
  });

  it('never transitions a state to itself', () => {
    expect(transitionTriples().filter(([, from, to]) => from === to)).toEqual([]);
  });
});

describe('the vocabulary', () => {
  it('prints a case code the way CWT-S15 and CWT-S18 show it', () => {
    expect(disputeCode(88_213)).toBe('DIS-088213');
    expect(disputeCode(1)).toBe('DIS-000001');
  });

  it('keeps M3 D4 to four money outcomes', () => {
    expect([...DECISION_OUTCOMES]).toEqual([
      'REFUND_BUYER_FULL',
      'REFUND_BUYER_PARTIAL',
      'RELEASE_SELLER_FULL',
      'RELEASE_SELLER_PARTIAL',
    ]);
  });
});
