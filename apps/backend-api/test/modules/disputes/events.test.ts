// The event contract F-033, F-034 and F-035 will consume. These assertions are deliberately about
// shape rather than behaviour: once another feature reads `disputes.dispute.resolved`, changing a
// field name here is a breaking change, and the test is where that gets noticed.
import { describe, expect, it } from 'vitest';
import {
  DISPUTE_EVENTS,
  disputeClosed,
  disputeOpened,
  disputeResolved,
} from '../../../src/modules/disputes/domain/events.js';

describe('the event catalogue', () => {
  it('names every event module.aggregate.event, under the disputes module', () => {
    for (const event of DISPUTE_EVENTS) {
      expect(event.eventType).toMatch(/^disputes\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });

  it('declares each event exactly once', () => {
    const types = DISPUTE_EVENTS.map((event) => event.eventType);
    expect(new Set(types).size).toBe(types.length);
  });

  it('starts every event at version 1', () => {
    for (const event of DISPUTE_EVENTS) expect(event.version).toBe(1);
  });
});

const RESOLVED = {
  disputeId: '11111111-1111-4111-8111-111111111111',
  disputeNumber: 88_213,
  tradeId: '22222222-2222-4222-8222-222222222222',
  decisionId: '7',
  decisionType: 'ORIGINAL' as const,
  outcome: 'REFUND_BUYER_FULL' as const,
  totalEscrowMinor: '45200000',
  amountToBuyerMinor: '45200000',
  amountToSellerMinor: '0',
  decidedByUserId: '33333333-3333-4333-8333-333333333333',
  rationale: 'The delivered item’s colour did not match the listing as agreed in §2.',
  agreedNote: null,
  decidedAt: '2026-11-25T12:00:00.000Z',
};

describe('disputes.dispute.resolved — the money instruction', () => {
  it('accepts a full payload', () => {
    expect(disputeResolved.payload.safeParse(RESOLVED).success).toBe(true);
  });

  it('insists on the escrowed total, so a consumer can re-check the arithmetic itself', () => {
    const { totalEscrowMinor: _dropped, ...without } = RESOLVED;
    expect(disputeResolved.payload.safeParse(without).success).toBe(false);
  });

  it('carries kobo as a digit string, never a number', () => {
    expect(disputeResolved.payload.safeParse({ ...RESOLVED, amountToBuyerMinor: 45_200_000 }).success).toBe(
      false,
    );
    expect(disputeResolved.payload.safeParse({ ...RESOLVED, amountToBuyerMinor: '452.00' }).success).toBe(
      false,
    );
  });

  it('allows a mediated decision with no deciding reviewer but an agreed note (Q10)', () => {
    const mediated = {
      ...RESOLVED,
      decisionType: 'MEDIATED' as const,
      decidedByUserId: null,
      agreedNote: 'Seller reships the correct colour; buyer returns the wrong unit, self-arranged.',
    };
    expect(disputeResolved.payload.safeParse(mediated).success).toBe(true);
  });

  it('refuses a decision with no rationale', () => {
    expect(disputeResolved.payload.safeParse({ ...RESOLVED, rationale: '' }).success).toBe(false);
  });
});

describe('disputes.dispute.opened', () => {
  it('carries both windows and both parties, so a consumer needs no second read', () => {
    const shape = disputeOpened.payload.safeParse({
      disputeId: RESOLVED.disputeId,
      disputeNumber: 1,
      tradeId: RESOLVED.tradeId,
      category: 'ITEM_NOT_AS_DESCRIBED',
      creationPath: 'DIRECT_FILING',
      openedByUserId: RESOLVED.decidedByUserId,
      buyerUserId: RESOLVED.decidedByUserId,
      sellerUserId: RESOLVED.disputeId,
      sourceTicketId: null,
      totalEscrowMinor: '45200000',
      mediationDeadlineAt: '2026-11-21T09:00:00.000Z',
      evidenceDeadlineAt: '2026-11-24T09:00:00.000Z',
    });
    expect(shape.success).toBe(true);
  });
});

describe('disputes.dispute.closed', () => {
  it('says which end it came to, because a withdrawal and a lapsed appeal are not the same', () => {
    for (const reason of ['WITHDRAWN', 'APPEAL_DECIDED', 'APPEAL_WINDOW_LAPSED'] as const) {
      const parsed = disputeClosed.payload.safeParse({
        disputeId: RESOLVED.disputeId,
        disputeNumber: 1,
        tradeId: RESOLVED.tradeId,
        from: 'DECIDED',
        reason,
        closedAt: RESOLVED.decidedAt,
      });
      expect(parsed.success).toBe(true);
    }
  });
});
