// Today's selling total for the selling limit (domain/sellLimit.ts, owner ruling 2026-11-20).
import type { Kobo } from '@komtru/shared-types';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../../platform/events/publish.js';

/**
 * Serialises selling commitments per seller for the rest of the transaction. Without it two
 * acceptances at once each read the same total, each pass, and together go over the daily limit.
 */
export async function lockSellerAllowance(tx: Tx, sellerUserId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`trades:sell-limit:${sellerUserId.toLowerCase()}`}))`,
  );
}

/**
 * The item value this seller has committed to in the Lagos calendar day holding `at`, leaving out
 * `excludeTradeId` (the trade being decided, whose new amount the caller adds).
 *
 * A trade counts once the seller has committed to it: it was accepted, or the seller's own terms are
 * the ones on the table (they created or countered it). A buyer's request the seller has not
 * answered does not count, so nobody can use up someone else's allowance by sending them requests.
 * It counts on the day it was accepted, or until then the day the seller's terms were put up.
 * Drafts, and trades that were declined, rejected, cancelled (refunded or not) or expired, never count.
 */
export async function sellingTodayMinor(
  tx: Tx,
  input: { sellerUserId: string; at: Date; excludeTradeId?: string },
): Promise<Kobo> {
  const at = input.at.toISOString();
  const result = await tx.execute<{ total: string | null }>(sql`
    SELECT COALESCE(SUM(v.item_amount_minor), 0)::text AS total
    FROM trade.trades t
    JOIN trade.trade_terms_versions v ON v.id = t.current_terms_version_id
    WHERE t.seller_user_id = ${input.sellerUserId}
      AND t.id IS DISTINCT FROM ${input.excludeTradeId ?? null}::uuid
      AND t.status NOT IN ('DRAFT', 'DECLINED', 'REJECTED', 'CANCELLED', 'CANCELLED_REFUNDED', 'EXPIRED')
      AND (t.accepted_at IS NOT NULL OR v.proposed_by_role = 'SELLER')
      AND COALESCE(t.accepted_at, v.created_at)
        >= (date_trunc('day', ${at}::timestamptz AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos')
      AND COALESCE(t.accepted_at, v.created_at)
        < ((date_trunc('day', ${at}::timestamptz AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos')
  `);
  return BigInt(result.rows[0]?.total ?? '0');
}
