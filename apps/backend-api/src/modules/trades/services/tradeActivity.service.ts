// `GET /trades/:id/activity`: the history a party may read (F-022 UI half). See `domain/tradeActivity.ts` for
// what is shown and what is withheld, and why.
import type { Paginated, TradeActivityItem } from '@komtru/shared-types';
import { sql } from 'drizzle-orm';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import {
  ACTIVITY_EVENTS,
  readTradeActivityCursor,
  toActivityItem,
  tradeActivityCursor,
  type ActivityRow,
} from '../domain/tradeActivity.js';
import { tradeActivity, tradeStateChanges } from '../infrastructure/postgres/schema/audit.js';
import type { TradeDeps } from './ports.js';
import { loadTrade, requireParty } from './trade.service.js';

const MICRO = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

export async function listTradeActivity(
  deps: Pick<TradeDeps, 'db'>,
  input: { userId: string; tradeId: string; limit: number; cursor?: CursorKey | undefined },
): Promise<Paginated<TradeActivityItem>> {
  // A bad cursor is a 422 before anything is read; it never falls back to the first page.
  const after = readTradeActivityCursor(input.cursor, input.tradeId);

  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId);
    // The same door as `GET /trades/:id`: a stranger, a missing trade and a trade the counterparty may not see
    // yet (domain/visibility.ts) all look alike.
    const role = requireParty(trade, input.userId);
    const isInitiator = trade.initiatorUserId === input.userId;

    const events = sql.join(
      ACTIVITY_EVENTS.map((event) => sql`${event}`),
      sql`, `,
    );
    // Rows only the proposer may see are left out here, not after the page is cut, so a page is always full.
    const review = isInitiator
      ? sql``
      : sql`AND NOT (action = 'REJECT_REVIEW' OR (action = 'SEND' AND to_status = 'UNDER_PROPOSAL_REVIEW'))`;
    const cursor = after
      ? sql`WHERE (occurred_at, src, nid) < (${after.ts}::timestamptz, ${after.src}, ${after.n}::bigint)`
      : sql``;

    const result = await tx.execute<{
      src: 'S' | 'A';
      n: string;
      cursor_ts: string;
      actor_type: string;
      action: string | null;
      to_status: string | null;
      reason: string | null;
      event: string | null;
    }>(sql`
      SELECT src, n, cursor_ts, actor_type, action, to_status, reason, event
      FROM (
        SELECT 'S'::text AS src, id::text AS n, id AS nid, occurred_at AS occurred_at,
               ${MICRO('occurred_at')} AS cursor_ts, actor_type::text AS actor_type,
               action::text AS action, to_status::text AS to_status, reason AS reason, NULL::text AS event
        FROM ${tradeStateChanges}
        WHERE trade_id = ${trade.id} ${review}
        UNION ALL
        SELECT 'A'::text, id::text, id, occurred_at, ${MICRO('occurred_at')}, actor_type::text,
               NULL::text, NULL::text, NULL::text, metadata->>'event'
        FROM ${tradeActivity}
        WHERE trade_id = ${trade.id} AND metadata->>'event' IN (${events})
      ) feed
      ${cursor}
      ORDER BY occurred_at DESC, src DESC, nid DESC
      LIMIT ${input.limit + 1}
    `);

    const rows: ActivityRow[] = result.rows.map((row) => ({
      src: row.src,
      n: row.n,
      occurredAt: row.cursor_ts,
      cursorTs: row.cursor_ts,
      actorType: row.actor_type,
      action: row.action,
      toStatus: row.to_status,
      reason: row.reason,
      event: row.event,
    }));
    const page = cursorPage(rows, input.limit, (row) => tradeActivityCursor(row, trade.id));
    const items = page.items.flatMap((row) => {
      const item = toActivityItem(row, { role, isInitiator });
      return item ? [item] : [];
    });
    return { items, nextCursor: page.nextCursor };
  });
}
