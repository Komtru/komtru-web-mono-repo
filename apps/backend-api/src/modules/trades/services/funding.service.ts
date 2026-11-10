// F-024: the ledger's answer to a buyer paying. The ledger never moves a trade (T-072); it publishes
// `ledger.payment.escrow_funded` once the charge is verified and posted, and this is where the trade follows.
import { eq } from 'drizzle-orm';
import { type Tx } from '../../../platform/events/publish.js';
import type { TradeStatus } from '../domain/stateMachine.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { applyTransition } from '../infrastructure/postgres/transitions.js';
import { recordActivity } from './trade.service.js';

export type FundOutcome = 'FUNDED' | 'ALREADY_FUNDED' | 'UNKNOWN_TRADE' | 'IGNORED';

/** Every status a funded trade can be in. A trade here has had its FUND transition already. */
const FUNDED_OR_LATER: ReadonlySet<TradeStatus> = new Set<TradeStatus>([
  'FUNDED',
  'SHIPPED',
  'UNCONFIRMED_DELIVERY',
  'INSPECTION',
  'DISPUTED',
  'COMPLETED',
  'SETTLED',
  'RESOLVED_REFUNDED',
  'RESOLVED_RELEASED',
  'CANCELLED_REFUNDED',
]);

/**
 * `ledger.payment.escrow_funded`: `PENDING_PAYMENT -> FUNDED`, as the ledger. Runs in the event's own
 * transaction, so the transition and the claim on the event commit together, and the state change it
 * publishes is what opens the delivery deadline, tells the seller and pushes to both workspace tabs.
 *
 * Never throws for a trade it should not move, because a retried event would fail the same way. A trade
 * already funded is a no-op. A trade that ended before the event arrived (cancelled or expired after the
 * posting committed) is left alone and reported, so the caller can log it: the money is escrowed against a
 * trade that will not be funded, and T-072 decision 8 sends that to manual review, never an automatic refund.
 * A hold does not stop it: like the settle, it records money that has already moved.
 */
export async function fundTrade(
  tx: Tx,
  input: { tradeId: string; paymentAttemptId: string; journalEntryId: string; reference: string },
): Promise<FundOutcome> {
  const [trade] = await tx.select().from(trades).where(eq(trades.id, input.tradeId)).for('update');
  if (!trade) return 'UNKNOWN_TRADE';
  if (FUNDED_OR_LATER.has(trade.status)) return 'ALREADY_FUNDED';
  if (trade.status !== 'PENDING_PAYMENT') return 'IGNORED';
  const context = {
    paymentAttemptId: input.paymentAttemptId,
    journalEntryId: input.journalEntryId,
    reference: input.reference,
  };
  await applyTransition(tx, {
    tradeId: trade.id,
    action: 'FUND',
    to: 'FUNDED',
    actor: { type: 'LEDGER' },
    reason: 'ESCROW_FUNDED',
    context,
  });
  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'ESCROW_ACTION_SETTLED',
    actorType: 'SYSTEM',
    summary: "The ledger confirmed the buyer's payment; the funds are held in escrow",
    metadata: { event: 'ESCROW_FUNDED', ...context },
  });
  return 'FUNDED';
}
