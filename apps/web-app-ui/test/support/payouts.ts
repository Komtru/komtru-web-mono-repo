// Payout fixtures in the platform's own shapes (`@komtru/api-client`'s payout schemas parse every one).
import { id } from './trade';

export const ACCOUNT_ID = id(21);
export const OTHER_ACCOUNT_ID = id(22);
export const PAYOUT_ID = id(11);

export const destination = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT_ID,
  bankCode: '058',
  bankName: 'GTBank',
  accountNumberMasked: '******5567',
  accountName: 'ADA OBI',
  ...over,
});

export const summary = (over: Record<string, unknown> = {}) => ({
  currency: 'NGN',
  availableMinor: '120000000',
  inFlightMinor: '0',
  payoutFeeMinor: '0',
  mode: 'MANUAL',
  held: false,
  defaultAccount: destination(),
  ...over,
});

export const payoutAccount = (over: Record<string, unknown> = {}) => ({
  ...destination(),
  status: 'VERIFIED',
  isDefault: true,
  failureReason: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  verifiedAt: '2026-11-01T08:01:00.000Z',
  ...over,
});

export const payout = (over: Record<string, unknown> = {}) => ({
  id: PAYOUT_ID,
  reference: `payout-${PAYOUT_ID}`,
  status: 'SUCCEEDED',
  trigger: 'MANUAL',
  currency: 'NGN',
  amountMinor: '45200000',
  feeMinor: '0',
  transferAmountMinor: '45200000',
  destination: destination(),
  sourceTradeId: null,
  failureReason: null,
  requestedAt: '2026-08-06T13:41:00.000Z',
  dispatchedAt: '2026-08-06T13:41:05.000Z',
  completedAt: '2026-08-06T14:02:00.000Z',
  failedAt: null,
  ...over,
});
