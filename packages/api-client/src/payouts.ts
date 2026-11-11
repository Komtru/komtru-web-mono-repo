// Getting paid out (T-073, F-037): payout accounts, how a seller is paid, withdrawing, and the history and
// receipts. Mirrors `apps/backend-api/src/modules/ledger/http/payout.validation.ts` field for field, for the
// screens T-124 builds (Seller-6, AB5, AB6, WF1, PR1).
//
// Money is a digit string of kobo, as everywhere else. A screen never computes the fee or what reaches the
// bank: `payoutFeeMinor` on the summary is what a withdrawal asked for now is charged, and every payout
// carries its own frozen `feeMinor` and `transferAmountMinor`. An account number is sent once, when the
// account is added, and never comes back: every response carries `accountNumberMasked` only.
//
// Three refusals each send the seller somewhere different, by problem code: `PAYOUT_ACCOUNT_REQUIRED` (add or
// verify a bank account), `INSUFFICIENT_BALANCE` (withdraw less), `PAYOUT_HELD` (contact support).
import {
  PAYOUT_ACCOUNT_STATUSES,
  PAYOUT_MODES,
  PAYOUT_STATUSES,
  PAYOUT_TRIGGERS,
  cursorPageRequestSchema,
  paginatedSchema,
} from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

export { PAYOUT_ACCOUNT_STATUSES, PAYOUT_MODES, PAYOUT_STATUSES, PAYOUT_TRIGGERS };

const idParams = z.object({ id: z.uuid() });
const kobo = z.string().regex(/^\d{1,19}$/);

export const bankSchema = z.looseObject({ name: z.string(), code: z.string() });
export type Bank = z.infer<typeof bankSchema>;

export const payoutAccountSchema = z.looseObject({
  id: z.uuid(),
  bankCode: z.string(),
  bankName: z.string().nullable(),
  /** `******5567`: the only form of the number the platform ever sends. */
  accountNumberMasked: z.string(),
  /** The holder's name as the bank resolved it; null until verified. Never typed by the seller. */
  accountName: z.string().nullable(),
  status: z.enum(PAYOUT_ACCOUNT_STATUSES),
  /** Where automatic payouts go. Only a verified account can be it. */
  isDefault: z.boolean(),
  /** Why verification failed, in words a seller can act on. */
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  verifiedAt: z.string().nullable(),
});
export type PayoutAccount = z.infer<typeof payoutAccountSchema>;

export const payoutDestinationSchema = z.looseObject({
  id: z.uuid(),
  bankCode: z.string(),
  bankName: z.string().nullable(),
  accountNumberMasked: z.string(),
  accountName: z.string().nullable(),
});
export type PayoutDestination = z.infer<typeof payoutDestinationSchema>;

export const payoutPreferenceSchema = z.looseObject({
  mode: z.enum(PAYOUT_MODES),
  defaultAccount: payoutDestinationSchema.nullable(),
});
export type PayoutPreference = z.infer<typeof payoutPreferenceSchema>;

export const payoutSchema = z.looseObject({
  id: z.uuid(),
  /** OUR reference (`payout-<id>`): what the bank statement and support know the payout by. */
  reference: z.string(),
  status: z.enum(PAYOUT_STATUSES),
  trigger: z.enum(PAYOUT_TRIGGERS),
  currency: z.string(),
  /** What left the available balance. */
  amountMinor: kobo,
  /** The payout fee, frozen when the payout was asked for. */
  feeMinor: kobo,
  /** What the bank is sent: the amount less the fee. */
  transferAmountMinor: kobo,
  destination: payoutDestinationSchema.nullable(),
  /** AUTO_IMMEDIATE: the trade whose proceeds this paid out (PR1's "From trade"). */
  sourceTradeId: z.uuid().nullable(),
  /** FAILED or REVERSED: why, in words a seller can read (WF1). The whole amount is back in the balance. */
  failureReason: z.string().nullable(),
  requestedAt: z.string(),
  dispatchedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
});
export type Payout = z.infer<typeof payoutSchema>;

export const payoutSummarySchema = z.looseObject({
  currency: z.string(),
  /** What a withdrawal may take now. */
  availableMinor: kobo,
  /** Asked for and not yet arrived; already out of the available balance. */
  inFlightMinor: kobo,
  /** What a withdrawal asked for now would be charged. */
  payoutFeeMinor: kobo,
  mode: z.enum(PAYOUT_MODES),
  /** True while payouts are paused on the account. */
  held: z.boolean(),
  defaultAccount: payoutDestinationSchema.nullable(),
});
export type PayoutSummary = z.infer<typeof payoutSummarySchema>;

export const listBanks = defineEndpoint({
  method: 'get',
  path: '/payouts/banks',
  scope: 'CONSUMER',
  schema: { response: z.looseObject({ banks: z.array(bankSchema) }) },
});

export const listPayoutAccounts = defineEndpoint({
  method: 'get',
  path: '/me/payout-accounts',
  scope: 'CONSUMER',
  schema: { response: z.looseObject({ accounts: z.array(payoutAccountSchema) }) },
});

/**
 * 202: the account is stored PENDING_VERIFICATION and checked with the bank by a job; poll the list until it is
 * VERIFIED or FAILED. Adding the same account again returns the same row, so no idempotency key is needed.
 */
export const addPayoutAccount = defineEndpoint({
  method: 'post',
  path: '/me/payout-accounts',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.object({ bankCode: z.string().min(1), accountNumber: z.string().min(10).max(20) }),
    response: payoutAccountSchema,
  },
});

export const setDefaultPayoutAccount = defineEndpoint({
  method: 'post',
  path: '/me/payout-accounts/:id/default',
  scope: 'CONSUMER',
  retryable: false,
  schema: { params: idParams, response: payoutAccountSchema },
});

/** Refused (409 `PAYOUT_ACCOUNT_REQUIRED`) while automatic payouts go to it; 409 `CONFLICT` while one is on its way. */
export const removePayoutAccount = defineEndpoint({
  method: 'delete',
  path: '/me/payout-accounts/:id',
  scope: 'CONSUMER',
  retryable: false,
  schema: { params: idParams, response: payoutAccountSchema },
});

export const getPayoutPreference = defineEndpoint({
  method: 'get',
  path: '/me/payout-preferences',
  scope: 'CONSUMER',
  schema: { response: payoutPreferenceSchema },
});

/** Any mode but MANUAL needs a verified default account (409 `PAYOUT_ACCOUNT_REQUIRED`). */
export const setPayoutPreference = defineEndpoint({
  method: 'put',
  path: '/me/payout-preferences',
  scope: 'CONSUMER',
  retryable: false,
  schema: { body: z.object({ mode: z.enum(PAYOUT_MODES) }), response: payoutPreferenceSchema },
});

export const getPayoutSummary = defineEndpoint({
  method: 'get',
  path: '/me/payouts/summary',
  scope: 'CONSUMER',
  schema: { response: payoutSummarySchema },
});

export const listPayouts = defineEndpoint({
  method: 'get',
  path: '/me/payouts',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: { query: cursorPageRequestSchema, response: paginatedSchema(payoutSchema) },
});

/** One payout: its outcome and receipt (PR1). */
export const getPayout = defineEndpoint({
  method: 'get',
  path: '/me/payouts/:id',
  scope: 'CONSUMER',
  schema: { params: idParams, response: payoutSchema },
});

/** Withdraw (AB5). Retryable: a double tap must be one withdrawal, so the client sends an idempotency key. */
export const requestPayout = defineEndpoint({
  method: 'post',
  path: '/me/payouts',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    body: z.object({ amountMinor: kobo, payoutAccountId: z.uuid().optional() }),
    response: payoutSchema,
  },
});
