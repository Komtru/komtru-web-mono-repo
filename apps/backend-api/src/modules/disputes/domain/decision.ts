// M3 D4: a decision is one of four outcomes and two amounts, and the two amounts must describe
// exactly the money the platform is holding. Pure bigint kobo; no clock, no I/O.
//
// This is the application's half of the "two checks, not one" rule on money movement. The second
// check is the `validate_decision_sums_to_escrow` trigger (M3 §5), which re-reads
// `disputes.total_escrow_minor` and refuses the insert whatever this file believed. The third is
// the ledger's own `assertSplitSums`, against the live escrow balance.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: apportion the platform commission. M3 speaks in two
// amounts (buyer, seller) summing to the escrowed item; the ledger posts three shares (seller
// proceeds, commission, buyer refund) summing to the same item, and T-070 says no fee rule is
// decided in the ledger. Nothing on record says how the commission is divided when a dispute
// splits an item, so this module stores and emits M3's two amounts and leaves the third share to
// whoever executes the settlement. Parked for the owner rather than guessed at.
import { decisionAmountsMismatch } from './errors.js';
import { DECISION_OUTCOMES, type DecisionOutcome } from './types.js';

export interface DecisionAmounts {
  toBuyerMinor: bigint;
  toSellerMinor: bigint;
}

/**
 * What the parties may agree between themselves in mediation (C13). The same four a reviewer could
 * have decided for them — mediation changes who decides, never what may be decided.
 */
export const MEDIATION_OUTCOMES: readonly DecisionOutcome[] = DECISION_OUTCOMES;

const isFull = (outcome: DecisionOutcome): boolean => outcome.endsWith('_FULL');

/** The whole escrow goes to the buyer on a refund, to the seller on a release. */
const fullAmounts = (outcome: DecisionOutcome, totalEscrowMinor: bigint): DecisionAmounts =>
  outcome === 'REFUND_BUYER_FULL'
    ? { toBuyerMinor: totalEscrowMinor, toSellerMinor: 0n }
    : { toBuyerMinor: 0n, toSellerMinor: totalEscrowMinor };

const assertEscrowPositive = (totalEscrowMinor: bigint): void => {
  if (totalEscrowMinor <= 0n) {
    throw decisionAmountsMismatch(`the escrowed total is ${totalEscrowMinor}, which is not money`);
  }
};

/**
 * The amounts an outcome implies. A full outcome determines both, so any hint is ignored. A partial
 * needs one side named and completes the other, so a caller never has to do the subtraction (and
 * never gets it wrong by a kobo).
 *
 * `REFUND_BUYER_PARTIAL` takes `toBuyerMinor` as the authoritative side, `RELEASE_SELLER_PARTIAL`
 * takes `toSellerMinor`: each outcome is named for the side the decider was reasoning about.
 */
export function amountsForOutcome(
  outcome: DecisionOutcome,
  totalEscrowMinor: bigint,
  hint?: { toBuyerMinor?: bigint; toSellerMinor?: bigint },
): DecisionAmounts {
  assertEscrowPositive(totalEscrowMinor);
  if (isFull(outcome)) return fullAmounts(outcome, totalEscrowMinor);

  const named = outcome === 'REFUND_BUYER_PARTIAL' ? hint?.toBuyerMinor : hint?.toSellerMinor;
  if (named === undefined) {
    const side = outcome === 'REFUND_BUYER_PARTIAL' ? 'toBuyerMinor' : 'toSellerMinor';
    throw decisionAmountsMismatch(`${outcome} needs an explicit ${side} amount`);
  }
  return outcome === 'REFUND_BUYER_PARTIAL'
    ? { toBuyerMinor: named, toSellerMinor: totalEscrowMinor - named }
    : { toBuyerMinor: totalEscrowMinor - named, toSellerMinor: named };
}

/**
 * Refuses any pair of amounts that is not a legal way to express `outcome` over `totalEscrowMinor`.
 *
 * Note what is NOT checked: which side got more on a partial. M3 gives a split two names and says
 * nothing about which one a given pair deserves, so deriving the label from the magnitudes would
 * invent a rule. The decider names the outcome; this only refuses amounts that lose money, invent
 * money, go negative, or call a whole-escrow award a "partial".
 */
export function assertDecisionSums(
  outcome: DecisionOutcome,
  amounts: DecisionAmounts,
  totalEscrowMinor: bigint,
): void {
  assertEscrowPositive(totalEscrowMinor);
  const { toBuyerMinor, toSellerMinor } = amounts;

  if (toBuyerMinor < 0n || toSellerMinor < 0n) {
    throw decisionAmountsMismatch(`a share is negative (buyer ${toBuyerMinor}, seller ${toSellerMinor})`);
  }

  const total = toBuyerMinor + toSellerMinor;
  if (total !== totalEscrowMinor) {
    throw decisionAmountsMismatch(
      `the amounts (buyer ${toBuyerMinor}, seller ${toSellerMinor}) do not sum to the escrowed total ${totalEscrowMinor}`,
    );
  }

  if (isFull(outcome)) {
    const expected = fullAmounts(outcome, totalEscrowMinor);
    if (toBuyerMinor !== expected.toBuyerMinor || toSellerMinor !== expected.toSellerMinor) {
      throw decisionAmountsMismatch(
        `${outcome} means buyer ${expected.toBuyerMinor} and seller ${expected.toSellerMinor}, not buyer ${toBuyerMinor} and seller ${toSellerMinor}`,
      );
    }
    return;
  }

  // A "partial" that hands the whole escrow to one side is a full outcome wearing the wrong label,
  // and the two are not interchangeable downstream: M7 reads the outcome to choose between
  // RESOLVED_REFUNDED and RESOLVED_RELEASED, and reputation reads it as a fault signal.
  if (toBuyerMinor === 0n || toSellerMinor === 0n) {
    throw decisionAmountsMismatch(
      `${outcome} is a partial outcome, but one side gets nothing (buyer ${toBuyerMinor}, seller ${toSellerMinor}) — use the matching _FULL outcome`,
    );
  }
}
