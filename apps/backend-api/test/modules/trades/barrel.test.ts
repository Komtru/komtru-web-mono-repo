// Another module reaches trades only through this barrel (komtru/module-boundaries), so everything
// a flow ticket needs has to leave by this door.
import { describe, expect, it } from 'vitest';
import * as trades from '../../../src/modules/trades/index.js';

describe('the trades module surface', () => {
  it('exports the state machine, the gates, the events and the transition chokepoint', () => {
    for (const name of [
      'canTransition',
      'isTransitionAllowed',
      'sourceStatuses',
      'isTerminal',
      'TRADE_STATUSES',
      'TRADE_ACTIONS',
      'invalidTransitionError',
      'merchantCannotBuyError',
      'canActAsBuyer',
      'assertCanActAsBuyer',
      'assertFundingEligibility',
      'initiatorRoleFor',
      'generateTradeCode',
      'feeSnapshotColumns',
      'assertFeeSnapshotConsistent',
      'decodeSnapshotAmounts',
      'withTradeCode',
      'tradeStateChangedEvent',
      'tradeEligibilityBlockedEvent',
      'applyTransition',
      'readTradePrincipal',
      'recordEligibilityBlock',
      'blockBuyerOrPass',
      'assertFundingEligibilityRecorded',
    ]) {
      expect(trades).toHaveProperty(name);
    }
  });

  it('exports every table a later module reads', () => {
    for (const table of [
      'trades',
      'tradeTermsVersions',
      'tradeStateChanges',
      'tradeActivity',
      'deliverySignals',
      'tradeDeadlines',
      'escrowActionRequests',
      'tradeHolds',
    ]) {
      expect(trades).toHaveProperty(table);
    }
  });
});
