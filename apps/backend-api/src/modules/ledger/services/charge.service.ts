// Starting a trade's funding (T-072): the buyer asks to pay, and gets a payment attempt with OUR
// reference and the snapshot's total, plus what Paystack Inline needs to open its checkout.
//
// No provider is called from here (design §4.4): Inline starts the charge in the browser against the
// server-issued reference, and the webhook plus the verify job confirm it. `confirmFunding` is the
// buyer's Inline callback; it believes nothing either, it only queues a verify sooner than the
// webhook would arrive.
import { randomUUID } from 'node:crypto';
import { koboToJson } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { ApiError } from '../../../platform/errors.js';
import type { Logger } from '../../../platform/logger.js';
import {
  assertFundingEligibilityRecorded,
  readTradePrincipal,
  tradeNotFoundError,
} from '../../trades/index.js';
import {
  canSupersedeAttempt,
  FundingSnapshotError,
  fundingAmounts,
  fundingReference,
  paymentDisplayState,
  PAYSTACK_INLINE_CHANNELS,
  type PaymentDisplayState,
} from '../domain/funding.js';
import { providerForNewCharge } from '../infrastructure/providerRegistry.js';
import {
  findCurrentAttempt,
  findOpenAttempt,
  findSucceededAttempt,
  insertPaymentAttempt,
  updatePaymentAttempt,
} from '../infrastructure/postgres/paymentsRepository.js';
import type { PaymentAttemptRow } from '../infrastructure/postgres/schema/payments.js';
import {
  buyerEmail,
  findTradeForFunding,
  type TradeForFunding,
  type TradeRef,
} from '../infrastructure/postgres/tradeFunding.js';

export interface ChargeDeps {
  db: Db;
  /** Paystack's public key, which Inline needs; absent in an environment without Paystack. */
  publicKey: string | undefined;
  /** Queues a verify of one charge. */
  enqueueVerify: (reference: string) => Promise<void>;
  logger: Logger;
}

export interface PaymentAttemptView {
  id: string;
  reference: string;
  status: PaymentAttemptRow['status'];
  displayState: PaymentDisplayState;
  currency: string;
  amountMinor: string;
  itemAmountMinor: string;
  buyerProtectionFeeMinor: string;
  initiatedAt: string;
  confirmedAt: string | null;
}

export interface PaymentStatusView {
  tradeId: string;
  tradeCode: string;
  /** NONE until the buyer has started a checkout. */
  displayState: PaymentDisplayState | 'NONE';
  attempt: PaymentAttemptView | null;
}

export interface InitiatedPayment extends PaymentStatusView {
  attempt: PaymentAttemptView;
  /** Exactly what `PaystackPop` is set up with (V1, V2). */
  inline: {
    key: string;
    email: string;
    /** Kobo. A number because that is what Inline takes; it is checked to be exact. */
    amount: number;
    currency: string;
    reference: string;
    channels: string[];
  };
}

const attemptView = (row: PaymentAttemptRow): PaymentAttemptView => ({
  id: row.id,
  reference: row.reference,
  status: row.status,
  displayState: paymentDisplayState(row),
  currency: row.currency,
  amountMinor: koboToJson(row.amountMinor),
  itemAmountMinor: koboToJson(row.itemAmountMinor),
  buyerProtectionFeeMinor: koboToJson(row.buyerProtectionFeeMinor),
  initiatedAt: row.initiatedAt.toISOString(),
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
});

const statusView = (trade: TradeForFunding, row: PaymentAttemptRow | undefined): PaymentStatusView => ({
  tradeId: trade.tradeId,
  tradeCode: trade.tradeCode,
  displayState: row ? paymentDisplayState(row) : 'NONE',
  attempt: row ? attemptView(row) : null,
});

const alreadyFunded = () =>
  new ApiError(409, 'CONFLICT', 'This trade is already funded', 'a payment for this trade has succeeded');

const notPayable = (status: string) =>
  new ApiError(409, 'INVALID_TRANSITION', 'This trade is not waiting for payment', `the trade is ${status}`);

/** The buyer's own trade, or a 404 — never a 403, which would confirm the trade exists. */
async function buyersTrade(db: Db, ref: TradeRef, userId: string): Promise<TradeForFunding> {
  const trade = await findTradeForFunding(db, ref);
  if (!trade || trade.buyerUserId !== userId) throw tradeNotFoundError();
  return trade;
}

/**
 * The money gates (design §6.3), recorded when they fire. Run in a transaction of their own so the
 * record of a refusal commits even though the refusal is then thrown.
 */
async function assertEligible(db: Db, trade: TradeForFunding): Promise<void> {
  const { buyerUserId, sellerUserId } = trade;
  if (!buyerUserId || !sellerUserId) throw notPayable(trade.status);
  const refusal = await db.transaction(async (tx) => {
    try {
      const buyer = await readTradePrincipal(tx, buyerUserId);
      const seller = await readTradePrincipal(tx, sellerUserId);
      await assertFundingEligibilityRecorded(tx, trade.tradeId, buyer, seller);
      return undefined;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
  });
  if (refusal) throw refusal;
}

export interface InitiateFundingInput {
  userId: string;
  trade: TradeRef;
  /**
   * Abandon the open checkout and issue a new reference. Only allowed while nothing is in flight on
   * the old one as far as the provider has said; money that lands on it later goes to review.
   */
  restart?: boolean;
}

/**
 * `POST /trades/:code/payment/initiate`. A repeat returns the open attempt rather than minting a
 * second reference, so a double tap is one checkout.
 */
export async function initiateFunding(
  deps: ChargeDeps,
  input: InitiateFundingInput,
): Promise<InitiatedPayment> {
  const { db } = deps;
  const trade = await buyersTrade(db, input.trade, input.userId);
  if (await findSucceededAttempt(db, trade.tradeId)) throw alreadyFunded();
  if (trade.status !== 'PENDING_PAYMENT') throw notPayable(trade.status);

  let amounts;
  try {
    amounts = fundingAmounts(trade);
  } catch (error) {
    if (error instanceof FundingSnapshotError) {
      deps.logger.error({ tradeId: trade.tradeId, detail: error.detail }, 'ledger: unfundable fee snapshot');
      throw new ApiError(409, 'CONFLICT', 'This trade cannot be paid for yet', error.detail);
    }
    throw error;
  }

  await assertEligible(db, trade);

  if (!deps.publicKey) {
    throw new ApiError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'The payment provider is unavailable',
      'PAYSTACK_PUBLIC_KEY is not set',
    );
  }
  const email = await buyerEmail(db, input.userId);
  if (!email) {
    throw new ApiError(
      422,
      'CONTACT_VERIFICATION_REQUIRED',
      'Add an email address to pay',
      'the payment provider sends its receipt to an email address',
    );
  }
  const amount = Number(amounts.totalMinor);
  if (!Number.isSafeInteger(amount)) {
    throw new ApiError(409, 'CONFLICT', 'This trade cannot be paid for online', 'the total is too large');
  }

  const attempt = await db
    .transaction(async (tx) => {
      const open = await findOpenAttempt(tx, trade.tradeId);
      if (open) {
        if (!input.restart) return open;
        if (!canSupersedeAttempt(open)) {
          throw new ApiError(
            409,
            'CONFLICT',
            'Your last payment is still being confirmed',
            'an attempt still verifying cannot be replaced',
          );
        }
        await updatePaymentAttempt(tx, open.id, {
          status: 'ABANDONED',
          closedAt: new Date(),
          failureReason: 'superseded by a new checkout',
        });
      }
      const id = randomUUID();
      return insertPaymentAttempt(tx, {
        id,
        tradeId: trade.tradeId,
        buyerUserId: input.userId,
        provider: providerForNewCharge(),
        reference: fundingReference(id),
        currency: amounts.currency,
        feeScheduleVersion: amounts.feeScheduleVersion,
        itemAmountMinor: amounts.itemAmountMinor,
        buyerProtectionFeeMinor: amounts.buyerProtectionFeeMinor,
        amountMinor: amounts.totalMinor,
      });
    })
    .catch(async (error: unknown) => {
      // Two first taps racing: the loser's insert hits the one-open index, and the winner's attempt
      // is the answer to both.
      if (isUniqueViolation(error, 'payment_attempts_one_open')) {
        const open = await findOpenAttempt(db, trade.tradeId);
        if (open) return open;
      }
      throw error;
    });

  return {
    ...statusView(trade, attempt),
    attempt: attemptView(attempt),
    inline: {
      key: deps.publicKey,
      email,
      amount,
      currency: attempt.currency,
      reference: attempt.reference,
      channels: [...PAYSTACK_INLINE_CHANNELS],
    },
  };
}

/**
 * `POST /trades/:code/payment/confirm`: Inline's success callback, and AB4's "check again". Moves
 * the open attempt to PENDING and queues a verify. Believes nothing: only the verify posts.
 */
export async function confirmFunding(
  deps: ChargeDeps,
  input: { userId: string; trade: TradeRef },
): Promise<PaymentStatusView> {
  const trade = await buyersTrade(deps.db, input.trade, input.userId);
  const succeeded = await findSucceededAttempt(deps.db, trade.tradeId);
  if (succeeded) return statusView(trade, succeeded);

  const open = await findOpenAttempt(deps.db, trade.tradeId);
  if (!open) throw new ApiError(409, 'CONFLICT', 'Start a payment first', 'there is no open payment attempt');

  const row = await deps.db.transaction(async (tx) =>
    open.status === 'INITIATED'
      ? updatePaymentAttempt(tx, open.id, { status: 'PENDING', pendingAt: new Date() })
      : open,
  );
  await deps.enqueueVerify(row.reference);
  return statusView(trade, row);
}

/** `GET /trades/:code/payment/status`: AB3, AB4 and V3, derived from the attempt. */
export async function paymentStatus(
  deps: Pick<ChargeDeps, 'db'>,
  input: { userId: string; trade: TradeRef },
): Promise<PaymentStatusView> {
  const trade = await buyersTrade(deps.db, input.trade, input.userId);
  return statusView(trade, await findCurrentAttempt(deps.db, trade.tradeId));
}
