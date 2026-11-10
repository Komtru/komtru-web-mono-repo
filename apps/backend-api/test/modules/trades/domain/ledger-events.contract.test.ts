// The cross-module contracts the trades module consumes: `ledger.payment.escrow_released` (and, below,
// `ledger.payment.escrow_funded`).
// If the ledger's producer and trades' consumer declaration drift apart, a trade reaches COMPLETED,
// never moves to SETTLED, and the money sits unpaid with nothing erroring. So this test uses the
// ledger's own exported definition, not a hand-rolled fixture.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ledgerEscrowFundedEvent,
  ledgerEscrowReleasedEvent,
} from '../../../../src/modules/trades/domain/ledgerEvents.js';
import {
  paymentEscrowFundedEvent,
  paymentEscrowReleasedEvent,
} from '../../../../src/modules/ledger/domain/events.js';

describe('ledger.payment.escrow_released (consumer contract)', () => {
  it('is the same event type and version as the ledger publishes', () => {
    expect(ledgerEscrowReleasedEvent.eventType).toBe(paymentEscrowReleasedEvent.eventType);
    expect(ledgerEscrowReleasedEvent.version).toBe(paymentEscrowReleasedEvent.version);
  });

  it('reads only fields the ledger actually declares', () => {
    const produced = Object.keys(paymentEscrowReleasedEvent.payload.shape);
    for (const field of Object.keys(ledgerEscrowReleasedEvent.payload.shape)) {
      expect(produced, `the ledger no longer publishes '${field}'`).toContain(field);
    }
  });

  it('parses a payload the ledger schema accepts, keeping the trade and journal ids', () => {
    const tradeId = randomUUID();
    const journalEntryId = randomUUID();
    const produced = paymentEscrowReleasedEvent.payload.parse({
      tradeId,
      journalEntryId,
      sellerUserId: randomUUID(),
      currency: 'NGN',
      outcome: 'RELEASED',
      itemAmountMinor: '45000000',
      sellerProceedsMinor: '45000000',
      commissionMinor: '0',
      refundToBuyerMinor: '0',
      buyerProtectionFeeMinor: '675000',
      buyerProtectionFeeTreatment: 'RECOGNISE',
      releasedAt: new Date().toISOString(),
    });
    expect(ledgerEscrowReleasedEvent.payload.parse(produced)).toEqual({ tradeId, journalEntryId });
  });
});

// F-024: `ledger.payment.escrow_funded`. If this drifts, a paid trade never leaves PENDING_PAYMENT.
describe('ledger.payment.escrow_funded (consumer contract)', () => {
  it('is the same event type and version as the ledger publishes', () => {
    expect(ledgerEscrowFundedEvent.eventType).toBe(paymentEscrowFundedEvent.eventType);
    expect(ledgerEscrowFundedEvent.version).toBe(paymentEscrowFundedEvent.version);
  });

  it('reads only fields the ledger actually declares', () => {
    const produced = Object.keys(paymentEscrowFundedEvent.payload.shape);
    for (const field of Object.keys(ledgerEscrowFundedEvent.payload.shape)) {
      expect(produced, `the ledger no longer publishes '${field}'`).toContain(field);
    }
  });

  it('parses a payload the ledger schema accepts, keeping what the transition records', () => {
    const tradeId = randomUUID();
    const paymentAttemptId = randomUUID();
    const journalEntryId = randomUUID();
    const produced = paymentEscrowFundedEvent.payload.parse({
      tradeId,
      paymentAttemptId,
      journalEntryId,
      provider: 'PAYSTACK',
      reference: `fund-${paymentAttemptId}`,
      currency: 'NGN',
      amountMinor: '45878000',
      itemAmountMinor: '45200000',
      buyerProtectionFeeMinor: '678000',
      fundedAt: new Date().toISOString(),
    });
    expect(ledgerEscrowFundedEvent.payload.parse(produced)).toEqual({
      tradeId,
      paymentAttemptId,
      journalEntryId,
      reference: `fund-${paymentAttemptId}`,
      currency: 'NGN',
      amountMinor: '45878000',
    });
  });
});
