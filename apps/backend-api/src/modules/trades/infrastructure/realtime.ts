// Trade realtime (T-068): who may be in a trade's room, and what is pushed into it.
//
// The room is `trade:<tradeCode>` over T-027's gateway. This file owns the one question the gateway
// cannot answer, "may this principal watch this trade?", and the shape of what a watcher is told.
//
// What a watcher is told is deliberately thin: that the trade changed, its new status and which event
// did it. No reason text, no actor, no amounts, no addresses. The room is a "refetch now" signal;
// what each party may SEE is decided by the HTTP read, which applies per-role disclosure and is
// re-authorised on every request. A push that carried the detail would make the socket a second,
// weaker read path — and the gateway does not re-authorise joined rooms when a role is revoked, so
// the thin payload is also what bounds that gap.
import { eq } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import type { RoomAuthorizer } from '../../socket/index.js';
import { trades } from './postgres/schema/trades.js';

export const TRADE_ROOM_PREFIX = 'trade';

/** The socket event every trade push uses. */
export const TRADE_UPDATED_EVENT = 'trade:updated';

/** The permission that lets staff watch any trade (M7 section 11). */
export const TRADE_VIEW_ALL = 'trade.view_all';

/**
 * Exactly the canonical stored form. `tradeCodeSchema` would accept `kmt-7398512` and normalise it, but
 * the gateway joins the id the client typed, while a push goes to the canonical room; accepting an
 * alias here would admit someone to a room nothing is ever sent to and invite a normalisation bug to
 * become an authorisation one. Anything else is refused before a query.
 */
const CANONICAL_TRADE_CODE = /^KMT-\d{5,8}-NG$/;

export interface TradeParties {
  buyerUserId: string | null;
  sellerUserId: string | null;
}

export interface TradeRoomDeps {
  /** `undefined` when no such trade exists. */
  parties: (tradeCode: string) => Promise<TradeParties | undefined>;
}

export const postgresTradeParties =
  (db: Pick<Db, 'select'>): TradeRoomDeps['parties'] =>
  async (tradeCode) => {
    const [row] = await db
      .select({ buyerUserId: trades.buyerUserId, sellerUserId: trades.sellerUserId })
      .from(trades)
      .where(eq(trades.tradeCode, tradeCode))
      .limit(1);
    return row;
  };

/**
 * Parties, and staff holding `trade.view_all`; nobody else. Default deny at every step: an unknown
 * trade and somebody else's trade give the same answer, so the room cannot be used to find out which
 * codes exist.
 *
 * - A party is the buyer or the seller of record, on a CONSUMER session. The initiator is always one
 *   of the two (a database check), and a counterparty who has not claimed the trade is not yet a party.
 * - Staff is the STAFF scope AND the permission, both read off the principal the gateway re-resolved
 *   from Postgres. The permission alone is not enough: a role is not a session scope.
 * - A user who is a party but signed in under the staff or logistics scope does not get the consumer
 *   view of their own trade through that session.
 */
export const tradeRoomAuthorizer =
  (deps: TradeRoomDeps): RoomAuthorizer =>
  async ({ principal, id }) => {
    if (!CANONICAL_TRADE_CODE.test(id)) return false;

    if (principal.scope !== 'STAFF' && principal.scope !== 'CONSUMER') return false;
    // Staff without the permission never reach the database either.
    if (principal.scope === 'STAFF' && !principal.permissions.has(TRADE_VIEW_ALL)) return false;

    const parties = await deps.parties(id);
    if (!parties) return false;
    if (principal.scope === 'STAFF') return true;
    return principal.userId === parties.buyerUserId || principal.userId === parties.sellerUserId;
  };
