// The automatic payouts (T-073): AUTO_IMMEDIATE pays out a release's proceeds the moment they land,
// and the daily sweep pays out the whole available balance for daily users every day, weekly users
// on Monday and monthly users on the 1st (Africa/Lagos). Both go through `executePayout`; neither
// ever calls the provider.
//
// A skip is not an error. A seller with no verified account, a hold, or nothing to pay out is a
// normal state, so a skip writes nothing and — for the reasons someone can act on — announces itself
// with `ledger.payout.auto_skipped`.
import { koboSchema, koboToJson, type Kobo } from '@komtru/shared-types';
import type { z } from 'zod';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { payoutAutoSkippedEvent, type paymentEscrowReleasedEvent } from '../domain/events.js';
import { sweepKey, sweepModesDue, type SweepMode } from '../domain/payouts.js';
import { accountBalance } from '../infrastructure/postgres/balancesRepository.js';
import {
  findPayoutMode,
  lockUserPayouts,
  staleInFlightPayouts,
  stalePendingAccounts,
  usersWithModes,
} from '../infrastructure/postgres/payoutsRepository.js';
import { executePayout, type ExecutePayoutDeps, type ExecutePayoutResult } from './payout.service.js';

type EscrowReleased = z.output<(typeof paymentEscrowReleasedEvent)['payload']>;

/** The skips worth telling someone about. A balance smaller than the fee is not one of them. */
const ANNOUNCED = new Set(['HELD', 'NO_VERIFIED_ACCOUNT', 'INSUFFICIENT_BALANCE']);

async function announceSkip(
  tx: Tx,
  result: Extract<ExecutePayoutResult, { outcome: 'REFUSED' }>,
  input: { userId: string; trigger: 'AUTO_IMMEDIATE' | 'AUTO_SWEEP'; key: string; amountMinor: Kobo },
): Promise<void> {
  if (!ANNOUNCED.has(result.reason) || result.reason === 'ACCOUNT_NOT_FOUND') return;
  await publish(tx, payoutAutoSkippedEvent, {
    aggregateType: 'ledger_payout_preference',
    aggregateId: input.userId,
    payload: {
      userId: input.userId,
      trigger: input.trigger,
      reason: result.reason,
      key: input.key,
      amountMinor: koboToJson(input.amountMinor),
    },
  });
}

/**
 * The `ledger.payment.escrow_released` subscriber, in the bus's claim transaction. Pays out exactly
 * the proceeds that release credited, once per release journal. When the balance no longer covers
 * them (the seller withdrew in between), it skips: no partial payout (owner decision 4).
 */
export async function payOutRelease(
  tx: Tx,
  deps: ExecutePayoutDeps,
  event: EscrowReleased,
): Promise<ExecutePayoutResult | 'NOT_AUTO_IMMEDIATE' | 'NOTHING_TO_PAY'> {
  const proceeds = koboSchema.parse(event.sellerProceedsMinor);
  if (proceeds <= 0n) return 'NOTHING_TO_PAY';
  if ((await findPayoutMode(tx, event.sellerUserId)) !== 'AUTO_IMMEDIATE') return 'NOT_AUTO_IMMEDIATE';

  const result = await executePayout(tx, deps, {
    userId: event.sellerUserId,
    amountMinor: proceeds,
    trigger: 'AUTO_IMMEDIATE',
    sourceJournalEntryId: event.journalEntryId,
    sourceTradeId: event.tradeId,
  });
  if (result.outcome === 'REFUSED') {
    deps.logger.info(
      { userId: event.sellerUserId, tradeId: event.tradeId, reason: result.reason },
      'ledger: auto-immediate payout skipped',
    );
    await announceSkip(tx, result, {
      userId: event.sellerUserId,
      trigger: 'AUTO_IMMEDIATE',
      key: event.journalEntryId,
      amountMinor: proceeds,
    });
  }
  return result;
}

export interface SweepDeps extends ExecutePayoutDeps {
  db: Db;
}

export interface SweepSummary {
  modes: SweepMode[];
  created: number;
  skipped: number;
  existing: number;
}

const SWEEP_PAGE = 200;

/**
 * `ledger.sweep-payouts-auto`, daily. Each user is one transaction of their own, so one seller's
 * failure is not everybody's, and a re-run the same day pays nobody twice (the sweep key).
 */
export async function sweepAutoPayouts(deps: SweepDeps): Promise<SweepSummary> {
  const now = deps.now?.() ?? new Date();
  const modes = sweepModesDue(now);
  const summary: SweepSummary = { modes, created: 0, skipped: 0, existing: 0 };

  let after: string | null = null;
  for (;;) {
    const page = await usersWithModes(deps.db, modes, after, SWEEP_PAGE);
    for (const { userId, mode } of page) {
      try {
        const outcome = await sweepOne(deps, userId, mode as SweepMode, now);
        if (outcome === 'CREATED') summary.created += 1;
        else if (outcome === 'EXISTS') summary.existing += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.skipped += 1;
        deps.logger.error({ err: error, userId }, 'ledger: sweep payout failed for one user');
      }
    }
    if (page.length < SWEEP_PAGE) break;
    after = page.at(-1)?.userId ?? null;
  }
  deps.logger.info({ ...summary }, 'ledger: automatic payout sweep finished');
  return summary;
}

async function sweepOne(
  deps: SweepDeps,
  userId: string,
  mode: SweepMode,
  now: Date,
): Promise<ExecutePayoutResult['outcome'] | 'EMPTY'> {
  const key = sweepKey(mode, userId, now);
  return deps.db.transaction(async (tx) => {
    // The balance is read under the same lock `executePayout` takes (advisory locks stack within a
    // transaction), so the amount swept is exactly what is available when the payout is written.
    await lockUserPayouts(tx, userId);
    const available = (await accountBalance(tx, { type: 'USER_PAYABLE', ownerUserId: userId })).balanceMinor;
    if (available <= 0n) return 'EMPTY';
    const result = await executePayout(
      tx,
      { ...deps, now: () => now },
      {
        userId,
        amountMinor: available,
        trigger: 'AUTO_SWEEP',
        sweepKey: key,
      },
    );
    if (result.outcome === 'REFUSED') {
      await announceSkip(tx, result, { userId, trigger: 'AUTO_SWEEP', key, amountMinor: available });
    }
    return result.outcome;
  });
}

/** REQUESTED this long without a dispatch means the requested event's job never ran. */
export const STALE_REQUESTED_MS = 2 * 60_000;
/** PROCESSING this quiet is verified again; each verify resets the clock. */
export const STALE_PROCESSING_MS = 15 * 60_000;
/** A pending account this old has lost its verify job. */
export const STALE_ACCOUNT_MS = 10 * 60_000;
export const BACKSTOP_BATCH = 100;

/** `ledger.sweep-payouts`, every five minutes: re-drives what a lost job left behind. */
export async function sweepInFlightPayouts(deps: {
  db: Db;
  logger: Logger;
  enqueuePayout: (payoutId: string) => Promise<void>;
  enqueueAccount: (payoutAccountId: string) => Promise<void>;
  now?: Date;
}): Promise<{ payouts: number; accounts: number }> {
  const now = deps.now ?? new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const ids = [
    ...(await staleInFlightPayouts(deps.db, ['REQUESTED'], ago(STALE_REQUESTED_MS), BACKSTOP_BATCH)),
    ...(await staleInFlightPayouts(deps.db, ['PROCESSING'], ago(STALE_PROCESSING_MS), BACKSTOP_BATCH)),
  ];
  for (const id of ids) await deps.enqueuePayout(id);
  // A day's worth of retries, then it is left FAILED-in-waiting for ops rather than retried forever.
  const accounts = await stalePendingAccounts(
    deps.db,
    ago(STALE_ACCOUNT_MS),
    ago(24 * 60 * 60_000),
    BACKSTOP_BATCH,
  );
  for (const id of accounts) await deps.enqueueAccount(id);
  if (ids.length || accounts.length) {
    deps.logger.warn(
      { payouts: ids.length, accounts: accounts.length },
      'ledger: re-queued stalled payout work',
    );
  }
  return { payouts: ids.length, accounts: accounts.length };
}
