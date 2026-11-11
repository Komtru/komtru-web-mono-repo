// Creating a payout (T-073): the one function every trigger goes through — the seller's withdraw
// (AB5), the auto-immediate listener and the daily sweep — and the holds that stop it.
//
// What makes two withdrawals against one balance safe is a per-user advisory lock, taken before the
// balance is read and held until the debit commits. The balance is a SUM over the journal (never a
// stored number), and the debit is in that journal, so the second request reads a balance the first
// has already reduced. `placePayoutHold` takes the same lock, so a hold and a payout cannot
// interleave either: whichever commits second sees the first.
//
// Nothing here calls the provider (design §4.4). The payout is written REQUESTED with its initiated
// journal and a `ledger.payout.requested` event, all in the caller's transaction; the dispatch job,
// queued by the ledger's own subscriber to that event, is the only caller of `initiateTransfer`.
import { randomUUID } from 'node:crypto';
import { koboToJson, type Kobo } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { snapshotPayoutFee } from '../../config/index.js';
import { payoutRequestedEvent, type PAYOUT_SKIP_REASONS } from '../domain/events.js';
import {
  initiatedPayoutLines,
  PayoutAmountError,
  payoutAmounts,
  payoutIdempotencyKey,
  payoutReference,
} from '../domain/payouts.js';
import { accountBalance } from '../infrastructure/postgres/balancesRepository.js';
import {
  activePayoutHolds,
  findDefaultAccount,
  findPayout,
  findPayoutAccount,
  findPayoutBySource,
  findPayoutBySweepKey,
  findPayoutHold,
  findPayoutMode,
  inFlightTotal,
  insertPayout,
  insertPayoutHold,
  listUserPayouts,
  lockUserPayouts,
  releasePayoutHoldRow,
} from '../infrastructure/postgres/payoutsRepository.js';
import type {
  PayoutAccountRow,
  PayoutHoldRow,
  PayoutHoldType,
  PayoutMode,
  PayoutRow,
  PayoutTrigger,
} from '../infrastructure/postgres/schema/payouts.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import type { Paginated } from '@komtru/shared-types';
import { postJournal } from './journal.service.js';

export type PayoutSkipReason = (typeof PAYOUT_SKIP_REASONS)[number];

/** The frozen `payout_fee`, as the config module hands it out. Tests substitute their own. */
export interface PayoutFee {
  version: string;
  currency: string;
  amountMinor: Kobo;
}

export interface ExecutePayoutDeps {
  logger: Logger;
  /** Defaults to `snapshotPayoutFee` from the fee file (design §6.5). */
  fee?: () => PayoutFee;
  now?: () => Date;
}

export interface ExecutePayoutInput {
  userId: string;
  amountMinor: Kobo;
  trigger: PayoutTrigger;
  /** MANUAL may name one of the seller's verified accounts; automatic payouts use the default. */
  payoutAccountId?: string;
  /** AUTO_IMMEDIATE: the release journal whose credit this pays out, and its trade. */
  sourceJournalEntryId?: string;
  sourceTradeId?: string;
  /** AUTO_SWEEP: `<mode>:<user>:<lagos date>`. */
  sweepKey?: string;
  correlationId?: string;
  causationId?: string;
}

export type ExecutePayoutResult =
  /** Written, posted and announced in the caller's transaction. */
  | { outcome: 'CREATED'; payout: PayoutRow }
  /** This credit or this day's sweep was already paid out; nothing written. */
  | { outcome: 'EXISTS'; payout: PayoutRow }
  /** Nothing written; the reason is one a seller or an operator can act on. */
  | { outcome: 'REFUSED'; reason: PayoutSkipReason | 'ACCOUNT_NOT_FOUND'; detail: string };

const feeOf = (deps: Pick<ExecutePayoutDeps, 'fee'>): PayoutFee => deps.fee?.() ?? snapshotPayoutFee();

/** An account money may be sent to: the user's own, verified, with a provider recipient. */
const payable = (account: PayoutAccountRow | undefined, userId: string): account is PayoutAccountRow =>
  account !== undefined &&
  account.userId === userId &&
  account.status === 'VERIFIED' &&
  account.providerRecipientId !== null;

/**
 * The only function that creates a payout. Runs in the CALLER's transaction and refuses — returning,
 * never throwing — a hold, a missing or unverified account, an amount the fee would swallow, and an
 * amount above the available balance. A defect (a negative fee, a fee in another currency) throws.
 */
export async function executePayout(
  tx: Tx,
  deps: ExecutePayoutDeps,
  input: ExecutePayoutInput,
): Promise<ExecutePayoutResult> {
  const userId = input.userId.toLowerCase();
  const now = deps.now?.() ?? new Date();
  await lockUserPayouts(tx, userId);

  // Once per credit and once per user per sweep day, checked under the same lock that writes them.
  if (input.sourceJournalEntryId) {
    const existing = await findPayoutBySource(tx, input.sourceJournalEntryId);
    if (existing) return { outcome: 'EXISTS', payout: existing };
  }
  if (input.sweepKey) {
    const existing = await findPayoutBySweepKey(tx, input.sweepKey);
    if (existing) return { outcome: 'EXISTS', payout: existing };
  }

  const holds = await activePayoutHolds(tx, userId, now);
  if (holds.length) {
    return { outcome: 'REFUSED', reason: 'HELD', detail: `${String(holds.length)} hold(s) on payouts` };
  }

  let account: PayoutAccountRow | undefined;
  if (input.payoutAccountId) {
    account = await findPayoutAccount(tx, input.payoutAccountId);
    if (!account || account.userId !== userId) {
      return { outcome: 'REFUSED', reason: 'ACCOUNT_NOT_FOUND', detail: 'no such payout account' };
    }
  } else {
    account = await findDefaultAccount(tx, userId);
  }
  if (!payable(account, userId)) {
    const status = (account as PayoutAccountRow | undefined)?.status;
    return {
      outcome: 'REFUSED',
      reason: 'NO_VERIFIED_ACCOUNT',
      detail: status ? `the account is ${status}` : 'no default payout account',
    };
  }

  const fee = feeOf(deps);
  const currency = fee.currency;
  let amounts;
  try {
    amounts = payoutAmounts(input.amountMinor, fee.amountMinor);
  } catch (error) {
    if (error instanceof PayoutAmountError && fee.amountMinor >= 0n) {
      return {
        outcome: 'REFUSED',
        reason: 'AMOUNT_TOO_SMALL',
        detail: `${String(input.amountMinor)} does not cover the payout fee of ${String(fee.amountMinor)}`,
      };
    }
    throw error;
  }

  const available = (await accountBalance(tx, { type: 'USER_PAYABLE', ownerUserId: userId }, currency))
    .balanceMinor;
  if (amounts.amountMinor > available) {
    return {
      outcome: 'REFUSED',
      reason: 'INSUFFICIENT_BALANCE',
      detail: `asked for ${String(amounts.amountMinor)}, available ${String(available)}`,
    };
  }

  const id = randomUUID();
  const reference = payoutReference(id);
  const posted = await postJournal(tx, {
    idempotencyKey: payoutIdempotencyKey(id, 'initiated'),
    description: `payout ${reference} requested (${input.trigger.toLowerCase()})`,
    currency,
    provider: account.provider,
    providerReference: reference,
    lines: initiatedPayoutLines({ userId, payoutId: id }, amounts),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
  });

  const payout = await insertPayout(tx, {
    id,
    userId,
    payoutAccountId: account.id,
    provider: account.provider,
    trigger: input.trigger,
    currency,
    amountMinor: amounts.amountMinor,
    feeMinor: amounts.feeMinor,
    feeScheduleVersion: fee.version,
    transferAmountMinor: amounts.transferAmountMinor,
    reference,
    initiatedJournalId: posted.journalEntry.id,
    requestedAt: now,
    ...(input.sourceJournalEntryId ? { sourceJournalEntryId: input.sourceJournalEntryId } : {}),
    ...(input.sourceTradeId ? { sourceTradeId: input.sourceTradeId } : {}),
    ...(input.sweepKey ? { sweepKey: input.sweepKey } : {}),
  });

  await publish(tx, payoutRequestedEvent, {
    aggregateType: 'ledger_payout',
    aggregateId: id,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
    payload: {
      payoutId: id,
      userId,
      trigger: input.trigger,
      reference,
      currency,
      amountMinor: koboToJson(amounts.amountMinor),
      feeMinor: koboToJson(amounts.feeMinor),
      transferAmountMinor: koboToJson(amounts.transferAmountMinor),
      requestedAt: now.toISOString(),
    },
  });

  return { outcome: 'CREATED', payout };
}

// ---------------------------------------------------------------------------------------------
// Holds (M13 §1: "M13 only requests a hold; M8 enforces it before disbursing")
// ---------------------------------------------------------------------------------------------

export interface PlaceHoldInput {
  userId: string;
  holdType: PayoutHoldType;
  /** `RISK_RULE:<rule>`, `REVIEWER:<staff id>`, … */
  source: string;
  reason: string;
  expiresAt?: Date;
}

/** Places a hold under the user's payout lock, so a payout being created right now commits first. */
export async function placePayoutHold(tx: Tx, input: PlaceHoldInput): Promise<PayoutHoldRow> {
  const userId = input.userId.toLowerCase();
  await lockUserPayouts(tx, userId);
  return insertPayoutHold(tx, {
    userId,
    holdType: input.holdType,
    source: input.source,
    reason: input.reason,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
}

/** Releases a hold once. Returns undefined when it does not exist or was already released. */
export async function releasePayoutHold(
  tx: Tx,
  input: { holdId: string; releasedBy: string; now?: Date },
): Promise<PayoutHoldRow | undefined> {
  const hold = await findPayoutHold(tx, input.holdId);
  if (!hold) return undefined;
  await lockUserPayouts(tx, hold.userId);
  return releasePayoutHoldRow(tx, input.holdId, input.releasedBy, input.now ?? new Date());
}

// ---------------------------------------------------------------------------------------------
// The seller's side: withdraw (AB5), the history and receipts (WF1, PR1), the balance (Seller-6)
// ---------------------------------------------------------------------------------------------

export interface PayoutServiceDeps extends ExecutePayoutDeps {
  db: Db;
}

export interface PayoutDestinationView {
  id: string;
  bankCode: string;
  bankName: string | null;
  accountNumberMasked: string;
  accountName: string | null;
}

export interface PayoutView {
  id: string;
  reference: string;
  status: PayoutRow['status'];
  trigger: PayoutRow['trigger'];
  currency: string;
  amountMinor: string;
  feeMinor: string;
  transferAmountMinor: string;
  destination: PayoutDestinationView | null;
  sourceTradeId: string | null;
  failureReason: string | null;
  requestedAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
}

export const destinationView = (account: PayoutAccountRow): PayoutDestinationView => ({
  id: account.id,
  bankCode: account.bankCode,
  bankName: account.bankName,
  accountNumberMasked: account.accountNumberMasked,
  accountName: account.accountName,
});

export const payoutView = (row: PayoutRow, account: PayoutAccountRow | undefined): PayoutView => ({
  id: row.id,
  reference: row.reference,
  status: row.status,
  trigger: row.trigger,
  currency: row.currency,
  amountMinor: koboToJson(row.amountMinor),
  feeMinor: koboToJson(row.feeMinor),
  transferAmountMinor: koboToJson(row.transferAmountMinor),
  destination: account ? destinationView(account) : null,
  sourceTradeId: row.sourceTradeId,
  failureReason: row.failureReason,
  requestedAt: row.requestedAt.toISOString(),
  dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
  completedAt: row.completedAt?.toISOString() ?? null,
  failedAt: row.failedAt?.toISOString() ?? null,
});

const notFound = () => new ApiError(404, 'NOT_FOUND', 'No such payout');

/** A refusal as the seller's screen needs it: each reason sends them somewhere different. */
export function refusalError(result: Extract<ExecutePayoutResult, { outcome: 'REFUSED' }>): ApiError {
  switch (result.reason) {
    case 'HELD':
      return new ApiError(
        409,
        'PAYOUT_HELD',
        'Payouts on your account are paused',
        'contact support to find out why',
      );
    case 'ACCOUNT_NOT_FOUND':
      return new ApiError(404, 'NOT_FOUND', 'No such payout account');
    case 'NO_VERIFIED_ACCOUNT':
      return new ApiError(
        409,
        'PAYOUT_ACCOUNT_REQUIRED',
        'Add a verified bank account to withdraw',
        result.detail,
      );
    case 'AMOUNT_TOO_SMALL':
      return new ApiError(422, 'VALIDATION_FAILED', 'This amount is too small to withdraw', result.detail);
    case 'INSUFFICIENT_BALANCE':
      return new ApiError(
        409,
        'INSUFFICIENT_BALANCE',
        'You cannot withdraw more than your available balance',
      );
  }
}

/** `POST /me/payouts`: a manual withdrawal. The route's idempotency key makes a double tap one payout. */
export async function requestPayout(
  deps: PayoutServiceDeps,
  input: { userId: string; amountMinor: Kobo; payoutAccountId?: string },
): Promise<PayoutView> {
  const result = await deps.db.transaction((tx) =>
    executePayout(tx, deps, {
      userId: input.userId,
      amountMinor: input.amountMinor,
      trigger: 'MANUAL',
      ...(input.payoutAccountId ? { payoutAccountId: input.payoutAccountId } : {}),
    }),
  );
  if (result.outcome === 'REFUSED') throw refusalError(result);
  const account = await findPayoutAccount(deps.db, result.payout.payoutAccountId);
  return payoutView(result.payout, account);
}

export async function getPayout(
  deps: Pick<PayoutServiceDeps, 'db'>,
  input: { userId: string; payoutId: string },
): Promise<PayoutView> {
  const row = await findPayout(deps.db, input.payoutId);
  // 404 for somebody else's payout as well as a missing one: not an id oracle.
  if (!row || row.userId !== input.userId.toLowerCase()) throw notFound();
  return payoutView(row, await findPayoutAccount(deps.db, row.payoutAccountId));
}

export async function listPayouts(
  deps: Pick<PayoutServiceDeps, 'db'>,
  input: { userId: string; limit: number; cursor?: CursorKey },
): Promise<Paginated<PayoutView>> {
  const at = input.cursor?.requestedAt;
  const id = input.cursor?.id;
  const cursor =
    typeof at === 'string' && typeof id === 'string' && !Number.isNaN(Date.parse(at))
      ? { requestedAt: new Date(at), id }
      : undefined;
  if (input.cursor && !cursor) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid cursor',
      'Use the nextCursor from the previous page',
    );
  }
  const rows = await listUserPayouts(deps.db, input.userId.toLowerCase(), input.limit, cursor);
  const accounts = new Map<string, PayoutAccountRow | undefined>();
  for (const row of rows) {
    if (!accounts.has(row.payoutAccountId)) {
      accounts.set(row.payoutAccountId, await findPayoutAccount(deps.db, row.payoutAccountId));
    }
  }
  return cursorPage(
    rows.map((row) => payoutView(row, accounts.get(row.payoutAccountId))),
    input.limit,
    (view) => ({ requestedAt: view.requestedAt, id: view.id }),
  );
}

export interface PayoutSummaryView {
  currency: string;
  /** The seller's payable: what a withdrawal may take. */
  availableMinor: string;
  /** Asked for and not yet settled or returned. Already out of the available balance. */
  inFlightMinor: string;
  /** The `payout_fee` a withdrawal asked for now would be charged. */
  payoutFeeMinor: string;
  mode: PayoutMode;
  /** True while a hold stops payouts. */
  held: boolean;
  defaultAccount: PayoutDestinationView | null;
}

/** `GET /me/payouts/summary`: Seller-6's balance card and AB5's fee line. */
export async function payoutSummary(
  deps: Pick<PayoutServiceDeps, 'db' | 'fee' | 'now'>,
  userId: string,
): Promise<PayoutSummaryView> {
  const user = userId.toLowerCase();
  const fee = feeOf(deps);
  const [balance, inFlight, mode, holds, account] = await Promise.all([
    accountBalance(deps.db, { type: 'USER_PAYABLE', ownerUserId: user }, fee.currency),
    inFlightTotal(deps.db, user),
    findPayoutMode(deps.db, user),
    activePayoutHolds(deps.db, user, deps.now?.() ?? new Date()),
    findDefaultAccount(deps.db, user),
  ]);
  return {
    currency: fee.currency,
    availableMinor: koboToJson(balance.balanceMinor < 0n ? 0n : balance.balanceMinor),
    inFlightMinor: koboToJson(inFlight),
    payoutFeeMinor: koboToJson(fee.amountMinor),
    mode,
    held: holds.length > 0,
    defaultAccount: account ? destinationView(account) : null,
  };
}
