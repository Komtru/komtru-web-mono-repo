// The one cross-module contract the trades module consumes: `ledger.payment.escrow_released`.
// If the ledger's producer and trades' consumer declaration drift apart, a trade reaches COMPLETED,
// never moves to SETTLED, and the money sits unpaid with nothing erroring. So this test uses the
// ledger's own exported definition, not a hand-rolled fixture.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ledgerEscrowReleasedEvent } from '../../../../src/modules/trades/domain/ledgerEvents.js';
import { paymentEscrowReleasedEvent } from '../../../../src/modules/ledger/domain/events.js';

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
