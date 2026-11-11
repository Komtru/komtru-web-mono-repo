// Sending a payout and finding out what became of it (T-073). The only place `initiateTransfer` is
// called, and the only place a payout reaches an outcome.
//
// Three rules carry the money:
//
//   * a payout is claimed REQUESTED → PROCESSING, under its row lock, BEFORE the transfer is asked
//     for. A second dispatch of the same payout finds it PROCESSING and only ever verifies it.
//   * an outcome is settled on the provider's transfer VERIFY answer, never on a webhook body and
//     never on the initiate call's own status — the same trust anchor as charges (m8 §7).
//   * an unanswered or failed initiate call leaves the payout PROCESSING, never reversed: the
//     provider may have accepted it. Only verify's "no transfer with this reference" proves it was
//     never sent, and only then is it sent again — under the same reference, which the provider
//     refuses to pay twice.
//
// Every outcome posts under `payout:<id>:<stage>` and the payout's status only moves forward
// (migration 0048), so a replayed webhook, a retried job and the sweep can all arrive at once and
// the money still moves once.
import { koboToJson } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { payoutCompletedEvent, type PAYOUT_OUTCOMES } from '../domain/events.js';
import {
  payoutIdempotencyKey,
  reversedPayoutLines,
  returnedPayoutLines,
  settledPayoutLines,
  TransferNotFoundError,
  transferOutcome,
  type PayoutJournalStage,
  type VerifiedTransferView,
} from '../domain/payouts.js';
import type { InitiateTransferInput, InitiateTransferResult } from '../domain/providerAdapter.js';
import {
  activePayoutHolds,
  findPayout,
  lockPayout,
  lockUserPayouts,
  updatePayout,
  findPayoutAccount,
  type PayoutChange,
} from '../infrastructure/postgres/payoutsRepository.js';
import type { PayoutRow, PayoutStatus } from '../infrastructure/postgres/schema/payouts.js';
import { postJournal } from './journal.service.js';

export interface PayoutDispatchDeps {
  db: Db;
  logger: Logger;
  initiateTransfer: (input: InitiateTransferInput) => Promise<InitiateTransferResult>;
  verifyTransfer: (reference: string) => Promise<VerifiedTransferView>;
  now?: () => Date;
}

const clock = (deps: Pick<PayoutDispatchDeps, 'now'>): Date => deps.now?.() ?? new Date();

/** Thrown after commit while the provider has not decided, so the queue's backoff asks again. */
export class PayoutStillPendingError extends Error {
  constructor(
    readonly payoutId: string,
    readonly providerStatus: string,
  ) {
    super(`payout ${payoutId} is still ${providerStatus}`);
    this.name = 'PayoutStillPendingError';
  }
}

/** Words a seller can read on WF1. Never a provider payload. */
export const HELD_REASON =
  'Payouts on your account are paused, so this withdrawal was returned to your balance.';
export const ACCOUNT_UNAVAILABLE_REASON =
  'The bank account for this withdrawal is no longer available, so it was returned to your balance.';
export const BANK_FAILED_REASON =
  'The bank did not accept this transfer, so it was returned to your balance.';
export const BANK_REVERSED_REASON = 'The bank returned this transfer, so it was added back to your balance.';

type Outcome = (typeof PAYOUT_OUTCOMES)[number];

const amountsOf = (payout: PayoutRow) => ({
  amountMinor: payout.amountMinor,
  feeMinor: payout.feeMinor,
  transferAmountMinor: payout.transferAmountMinor,
});

/** Posts one outcome journal for the payout. Idempotent by key; a differing replay throws. */
async function postStage(tx: Tx, payout: PayoutRow, stage: Exclude<PayoutJournalStage, 'initiated'>) {
  const parties = { userId: payout.userId, payoutId: payout.id };
  const lines =
    stage === 'settled'
      ? settledPayoutLines(parties, amountsOf(payout))
      : stage === 'reversed'
        ? reversedPayoutLines(parties, amountsOf(payout))
        : returnedPayoutLines(parties, amountsOf(payout));
  return postJournal(tx, {
    idempotencyKey: payoutIdempotencyKey(payout.id, stage),
    description: `payout ${payout.reference} ${stage}`,
    currency: payout.currency,
    provider: payout.provider,
    providerReference: payout.reference,
    lines,
  });
}

async function announce(
  tx: Tx,
  payout: PayoutRow,
  outcome: Outcome,
  journalEntryId: string | null,
  reason: string | null,
  now: Date,
): Promise<void> {
  await publish(tx, payoutCompletedEvent, {
    aggregateType: 'ledger_payout',
    aggregateId: payout.id,
    payload: {
      payoutId: payout.id,
      userId: payout.userId,
      outcome,
      reference: payout.reference,
      currency: payout.currency,
      amountMinor: koboToJson(payout.amountMinor),
      transferAmountMinor: koboToJson(payout.transferAmountMinor),
      journalEntryId,
      reason,
      completedAt: now.toISOString(),
    },
  });
}

/** Returns the whole debit to the payable and closes the payout FAILED or REVERSED. */
async function reverse(
  tx: Tx,
  payout: PayoutRow,
  status: 'FAILED' | 'REVERSED',
  reason: string,
  now: Date,
  extra: PayoutChange = {},
): Promise<PayoutRow> {
  // A paid transfer the bank sent back is money returning to the pool; one that never left clearing
  // is returned from clearing.
  const posted = await postStage(tx, payout, payout.status === 'SUCCEEDED' ? 'returned' : 'reversed');
  const row = await updatePayout(tx, payout.id, {
    ...extra,
    status,
    reversedJournalId: posted.journalEntry.id,
    failedAt: now,
    failureReason: reason,
  });
  await announce(tx, row, status, posted.journalEntry.id, reason, now);
  return row;
}

type Claim =
  | { kind: 'CLAIMED'; payout: PayoutRow; recipient: string }
  | { kind: 'CLOSED'; status: PayoutStatus }
  | { kind: 'NOT_REQUESTED'; status: PayoutStatus };

/**
 * REQUESTED → PROCESSING, or a hold or a vanished account closes it and gives the money back (owner
 * decision 7). Under the user's payout lock, so a hold placed this instant is seen.
 */
async function claim(deps: PayoutDispatchDeps, payoutId: string): Promise<Claim | undefined> {
  const now = clock(deps);
  return deps.db.transaction(async (tx): Promise<Claim | undefined> => {
    const peek = await findPayout(tx, payoutId);
    if (!peek) return undefined;
    await lockUserPayouts(tx, peek.userId);
    const payout = await lockPayout(tx, payoutId);
    if (!payout) return undefined;
    if (payout.status !== 'REQUESTED') return { kind: 'NOT_REQUESTED', status: payout.status };

    if ((await activePayoutHolds(tx, payout.userId, now)).length) {
      const row = await reverse(tx, payout, 'FAILED', HELD_REASON, now);
      deps.logger.warn({ payoutId }, 'ledger: payout returned at dispatch, a hold is in force');
      return { kind: 'CLOSED', status: row.status };
    }
    const account = await findPayoutAccount(tx, payout.payoutAccountId);
    if (account?.status !== 'VERIFIED' || !account.providerRecipientId) {
      const row = await reverse(tx, payout, 'FAILED', ACCOUNT_UNAVAILABLE_REASON, now);
      deps.logger.warn({ payoutId }, 'ledger: payout returned at dispatch, its account is not payable');
      return { kind: 'CLOSED', status: row.status };
    }
    const row = await updatePayout(tx, payout.id, { status: 'PROCESSING', dispatchedAt: now });
    return { kind: 'CLAIMED', payout: row, recipient: account.providerRecipientId };
  });
}

/** Asks the provider for the transfer and records its transfer code. Throws whatever it throws. */
async function send(deps: PayoutDispatchDeps, payout: PayoutRow, recipient: string): Promise<void> {
  const amount = Number(payout.transferAmountMinor);
  if (!Number.isSafeInteger(amount)) throw new Error(`ledger: payout ${payout.id} is too large to send`);
  const result = await deps.initiateTransfer({
    providerRecipientId: recipient,
    amountMinor: amount,
    reference: payout.reference,
    reason: 'Komtru payout',
  });
  await deps.db.transaction(async (tx) => {
    const locked = await lockPayout(tx, payout.id);
    if (!locked || locked.status === 'FAILED' || locked.status === 'REVERSED') return;
    await updatePayout(tx, payout.id, {
      ...(locked.providerTransferId ? {} : { providerTransferId: result.providerTransferId }),
      lastProviderStatus: result.status,
      lastCheckedAt: clock(deps),
    });
  });
}

export type PayoutProgress = PayoutStatus | 'MISSING';

/**
 * The dispatch job (`ledger.process-payout`): claims a REQUESTED payout and sends it, then settles it
 * on verify. A PROCESSING one is only verified. Throws `PayoutStillPendingError` while the provider
 * has not decided, and a provider error as it came: both leave the payout in flight, for the retry.
 */
export async function processPayout(deps: PayoutDispatchDeps, payoutId: string): Promise<PayoutProgress> {
  const claimed = await claim(deps, payoutId);
  if (!claimed) return 'MISSING';
  if (claimed.kind === 'CLOSED') return claimed.status;
  if (claimed.kind === 'CLAIMED') {
    await send(deps, claimed.payout, claimed.recipient);
  } else if (claimed.status !== 'PROCESSING') {
    return claimed.status;
  }
  return resolvePayout(deps, payoutId);
}

/**
 * Settles a payout on the provider's verify answer. Called by the dispatch job, the `transfer.*`
 * webhook and the sweep. A SUCCEEDED payout is verified too, because only a verify can show the bank
 * returned it; FAILED, REVERSED and NEEDS_REVIEW are final here.
 */
export async function resolvePayout(deps: PayoutDispatchDeps, payoutId: string): Promise<PayoutProgress> {
  const payout = await findPayout(deps.db, payoutId);
  if (!payout) return 'MISSING';
  if (payout.status !== 'PROCESSING' && payout.status !== 'SUCCEEDED') return payout.status;

  let verified: VerifiedTransferView;
  try {
    verified = await deps.verifyTransfer(payout.reference);
  } catch (error) {
    if (!(error instanceof TransferNotFoundError)) throw error;
    if (payout.status !== 'PROCESSING') {
      deps.logger.error({ payoutId }, 'ledger: a succeeded payout is unknown to the provider');
      return payout.status;
    }
    // The one answer that proves nothing was sent: send it again, under the same reference.
    deps.logger.warn({ payoutId }, 'ledger: payout unknown to the provider, sending it again');
    const account = await findPayoutAccount(deps.db, payout.payoutAccountId);
    if (!account?.providerRecipientId) throw error;
    await send(deps, payout, account.providerRecipientId);
    throw new PayoutStillPendingError(payoutId, 'resent');
  }

  const now = clock(deps);
  const result = await deps.db.transaction(
    async (tx): Promise<{ status: PayoutProgress; pending?: string }> => {
      const locked = await lockPayout(tx, payoutId);
      if (!locked) return { status: 'MISSING' };
      if (locked.status !== 'PROCESSING' && locked.status !== 'SUCCEEDED') return { status: locked.status };

      const seen: PayoutChange = {
        lastProviderStatus: verified.status,
        lastCheckedAt: now,
        ...(locked.providerTransferId ? {} : { providerTransferId: verified.providerTransferId }),
      };

      const mismatch = describeMismatch(locked, verified);
      if (mismatch) {
        if (locked.status === 'PROCESSING') {
          const row = await updatePayout(tx, locked.id, {
            ...seen,
            status: 'NEEDS_REVIEW',
            failureReason: null,
          });
          await announce(tx, row, 'NEEDS_REVIEW', null, mismatch, now);
        }
        deps.logger.error({ payoutId, mismatch }, 'ledger: verified transfer does not match the payout');
        return { status: locked.status === 'PROCESSING' ? 'NEEDS_REVIEW' : locked.status };
      }

      const outcome = transferOutcome(verified.status);
      if (locked.status === 'SUCCEEDED') {
        if (outcome === 'REVERSED') {
          return { status: (await reverse(tx, locked, 'REVERSED', BANK_REVERSED_REASON, now, seen)).status };
        }
        if (outcome === 'FAILED') {
          // Success then failure is not a sequence any provider documents. Nothing moves; a person looks.
          deps.logger.error(
            { payoutId, status: verified.status },
            'ledger: a succeeded payout now reads as failed',
          );
        }
        return { status: 'SUCCEEDED' };
      }

      switch (outcome) {
        case 'SUCCEEDED': {
          const posted = await postStage(tx, locked, 'settled');
          const row = await updatePayout(tx, locked.id, {
            ...seen,
            status: 'SUCCEEDED',
            settledJournalId: posted.journalEntry.id,
            completedAt: now,
          });
          await announce(tx, row, 'SUCCEEDED', posted.journalEntry.id, null, now);
          return { status: 'SUCCEEDED' };
        }
        case 'FAILED':
          return { status: (await reverse(tx, locked, 'FAILED', BANK_FAILED_REASON, now, seen)).status };
        case 'REVERSED':
          return { status: (await reverse(tx, locked, 'REVERSED', BANK_REVERSED_REASON, now, seen)).status };
        case 'PENDING':
          await updatePayout(tx, locked.id, seen);
          return { status: 'PROCESSING', pending: verified.status };
      }
    },
  );

  if (result.pending !== undefined) throw new PayoutStillPendingError(payoutId, result.pending);
  return result.status;
}

/** Why a verified transfer is not this payout, or nothing. Amount and currency are both money. */
function describeMismatch(payout: PayoutRow, verified: VerifiedTransferView): string | undefined {
  if (verified.reference !== payout.reference) {
    return `the provider answered for ${verified.reference}, not ${payout.reference}`;
  }
  if (verified.currency.toUpperCase() !== payout.currency) {
    return `the transfer is in ${verified.currency}, not ${payout.currency}`;
  }
  if (
    !Number.isSafeInteger(verified.amountMinor) ||
    BigInt(verified.amountMinor) !== payout.transferAmountMinor
  ) {
    return `the transfer is for ${String(verified.amountMinor)}, not ${String(payout.transferAmountMinor)}`;
  }
  if (payout.providerTransferId && payout.providerTransferId !== verified.providerTransferId) {
    return `the transfer code is ${verified.providerTransferId}, not ${payout.providerTransferId}`;
  }
  return undefined;
}
