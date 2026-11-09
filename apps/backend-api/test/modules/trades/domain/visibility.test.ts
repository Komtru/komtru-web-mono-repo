import { TRADE_STATUSES, type TradeStatus } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import {
  HIDDEN_AFTER_CANCEL_FROM,
  HIDDEN_STATUSES,
  canSeeTrade,
  isHiddenFromCounterparty,
  pushDisposition,
} from '../../../../src/modules/trades/domain/visibility.js';

const PROPOSER = 'u-proposer';
const OTHER = 'u-other';
const trade = (status: TradeStatus, previousStatus: TradeStatus | null = null) => ({
  status,
  previousStatus,
  initiatorUserId: PROPOSER,
});

describe('who may know a trade exists', () => {
  it.each(HIDDEN_STATUSES)('hides %s from the counterparty and never from the proposer', (status) => {
    expect(canSeeTrade(trade(status), OTHER)).toBe(false);
    expect(canSeeTrade(trade(status), PROPOSER)).toBe(true);
  });

  it.each(HIDDEN_AFTER_CANCEL_FROM)('hides a trade withdrawn from %s, which now reads CANCELLED', (from) => {
    expect(canSeeTrade(trade('CANCELLED', from), OTHER)).toBe(false);
    expect(canSeeTrade(trade('CANCELLED', from), PROPOSER)).toBe(true);
  });

  it('shows a trade cancelled in the ordinary way, and one whose past is unknown', () => {
    expect(canSeeTrade(trade('CANCELLED', 'AWAITING_ACCEPTANCE'), OTHER)).toBe(true);
    expect(canSeeTrade(trade('CANCELLED', 'PENDING_PAYMENT'), OTHER)).toBe(true);
    expect(canSeeTrade(trade('CANCELLED', null), OTHER)).toBe(true);
  });

  it('shows every other status to both people', () => {
    for (const status of TRADE_STATUSES) {
      if ((HIDDEN_STATUSES as readonly string[]).includes(status)) continue;
      expect(isHiddenFromCounterparty(trade(status, 'AWAITING_ACCEPTANCE')), status).toBe(false);
    }
  });
});

describe('what a state change may tell the room', () => {
  it('sends an ordinary change, including a draft being sent', () => {
    expect(pushDisposition('DRAFT', 'AWAITING_ACCEPTANCE')).toBe('SEND');
    expect(pushDisposition('FUNDED', 'SHIPPED')).toBe('SEND');
  });
  it('withholds anything into, out of, or ended from review, except a clearance', () => {
    expect(pushDisposition('DRAFT', 'UNDER_PROPOSAL_REVIEW')).toBe('WITHHOLD');
    expect(pushDisposition('UNDER_PROPOSAL_REVIEW', 'REJECTED')).toBe('WITHHOLD');
    expect(pushDisposition('UNDER_PROPOSAL_REVIEW', 'CANCELLED')).toBe('WITHHOLD');
    expect(pushDisposition('UNDER_PROPOSAL_REVIEW', 'AWAITING_ACCEPTANCE')).toBe('REDACT');
  });
});
