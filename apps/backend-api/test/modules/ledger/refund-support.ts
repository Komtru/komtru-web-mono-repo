// A funded trade as T-072 leaves one, for the refund tests: the fee snapshot frozen at acceptance, the
// funding journal posted, and the SUCCEEDED payment attempt that names the charge a refund reverses.
import { randomUUID } from 'node:crypto';
import { fundingJournalLines, postJournal } from '../../../src/modules/ledger/index.js';
import type { TestDatabase } from '../../support/db.js';
import {
  ROUTES,
  feeSnapshotColumnValues,
  insertRow,
  insertTermsVersion,
  insertTrade,
  insertUser,
  transition,
} from '../trades/support.js';

export const REFUND_ITEM = 45_000_000n;
export const REFUND_FEE = 675_000n;

export interface FundedTrade {
  tradeId: string;
  buyer: string;
  seller: string;
  attemptId: string;
  /** The charge's provider reference: what the Refund API is pointed at. */
  chargeReference: string;
  fundingJournalId: string;
}

export async function fundedTradeWithCharge(
  t: TestDatabase,
  options: {
    status?: string;
    item?: bigint;
    fee?: bigint;
    refundableOnFullRefund?: boolean;
    /** An existing buyer, for tests that need several trades by one person. */
    buyer?: string;
  } = {},
): Promise<FundedTrade> {
  const item = options.item ?? REFUND_ITEM;
  const fee = options.fee ?? REFUND_FEE;
  const buyer = options.buyer ?? (await insertUser(t.app(), { verification_level: 'CONTACT_VERIFIED' }));
  const seller = await insertUser(t.app(), { verification_level: 'IDENTITY_VERIFIED' });
  const tradeId = await insertTrade(t.app(), { buyer, seller });
  const terms = await insertTermsVersion(t.app(), tradeId, buyer, { item_amount_minor: item.toString() });
  for (const step of ROUTES[options.status ?? 'FUNDED'] ?? []) {
    const extra = step.fees
      ? {
          ...feeSnapshotColumnValues(item, fee, 0n, options.refundableOnFullRefund ?? true),
          accepted_terms_version_id: terms,
        }
      : {};
    await transition(t.app(), tradeId, step, extra);
  }

  const attemptId = randomUUID();
  const chargeReference = `fund-${attemptId}`;
  const posted = await t.db().transaction((tx) =>
    postJournal(tx, {
      idempotencyKey: `charge:${chargeReference}`,
      description: 'escrow funded',
      tradeId,
      provider: 'PAYSTACK',
      providerReference: chargeReference,
      lines: fundingJournalLines(tradeId, {
        currency: 'NGN',
        feeScheduleVersion: 'test-fee-schedule',
        itemAmountMinor: item,
        buyerProtectionFeeMinor: fee,
        totalMinor: item + fee,
      }),
    }),
  );
  await insertRow(t.app(), 'ledger.payment_attempts', {
    id: attemptId,
    trade_id: tradeId,
    buyer_user_id: buyer,
    provider: 'PAYSTACK',
    reference: chargeReference,
    provider_reference: chargeReference,
    fee_schedule_version: 'test-fee-schedule',
    item_amount_minor: item.toString(),
    buyer_protection_fee_minor: fee.toString(),
    amount_minor: (item + fee).toString(),
    status: 'SUCCEEDED',
    journal_entry_id: posted.journalEntry.id,
    confirmed_at: new Date(),
  });
  return { tradeId, buyer, seller, attemptId, chargeReference, fundingJournalId: posted.journalEntry.id };
}

export const outboxOf = async (t: TestDatabase, eventType: string): Promise<Record<string, unknown>[]> => {
  const { rows } = await t
    .app()
    .query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM platform.outbox WHERE event_type = $1 ORDER BY occurred_at`,
      [eventType],
    );
  return rows.map((row) => row.payload);
};
