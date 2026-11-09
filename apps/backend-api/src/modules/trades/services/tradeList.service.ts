// `GET /trades` and `GET /trades/by-code/:code` (T-068 follow-up, from F-017's review).
//
// Before these existed the only way to reach a trade was by its id, which only the creator ever had: a
// second device saw nothing, and a person invited to a trade had no route to it at all.
import {
  type CounterpartyDisplay,
  type Paginated,
  type TradeAttention,
  type TradeByCodeResponse,
  type TradeListItem,
  type TradeListState,
} from '@komtru/shared-types';
import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { tradeCategories } from '../../config/index.js';
import { partyInvitations } from '../../identity/index.js';
import { tradeNotFoundError } from '../domain/errors.js';
import type { TradeInitiatorRole } from '../domain/eligibility.js';
import { TERMINAL_STATUSES, type TradeStatus } from '../domain/stateMachine.js';
import { attentionFor, itemTitle, readTradeListCursor, tradeListCursor } from '../domain/tradeList.js';
import {
  deliveryExtensionRequests,
  inspectionExtensionRequests,
} from '../infrastructure/postgres/schema/fulfilment.js';
import { tradeTermsVersions } from '../infrastructure/postgres/schema/terms.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import type { TradeDeps } from './ports.js';
import { buildView, type TradeRow, type TradeView } from './trade.service.js';

type ListDeps = Pick<TradeDeps, 'db' | 'displays'>;

/**
 * What a counterparty may not see yet: a draft is nobody else's, and a proposal held for TrustOps review
 * is invisible to the party it was addressed to until staff clear it (M7 R1, T-062). Their list leaves
 * both out; the INITIATOR still sees their own. `GET /trades/:id` on a held proposal is T-062's to close.
 */
const HIDDEN_FROM_COUNTERPARTY: TradeStatus[] = ['DRAFT', 'UNDER_PROPOSAL_REVIEW'];

const CURSOR_TS = sql<string>`to_char(${trades.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const roleOf = (trade: Pick<TradeRow, 'buyerUserId'>, userId: string): TradeInitiatorRole =>
  trade.buyerUserId === userId ? 'BUYER' : 'SELLER';

export async function listTrades(
  deps: ListDeps,
  input: { userId: string; limit: number; state: TradeListState; cursor?: CursorKey | undefined },
): Promise<Paginated<TradeListItem>> {
  // Validated before any query: a bad cursor is a 422, never a quiet first page.
  const after = readTradeListCursor(input.cursor, input.state);
  const { userId } = input;

  return deps.db.transaction(async (tx) => {
    const rows = await tx
      .select({
        trade: trades,
        cursorTs: CURSOR_TS,
        categoryCode: tradeCategories.code,
        categoryName: tradeCategories.name,
        itemAmountMinor: tradeTermsVersions.itemAmountMinor,
        itemSpec: tradeTermsVersions.itemSpec,
        proposedByUserId: tradeTermsVersions.proposedByUserId,
      })
      .from(trades)
      .leftJoin(tradeCategories, eq(tradeCategories.id, trades.categoryId))
      .leftJoin(tradeTermsVersions, eq(tradeTermsVersions.id, trades.currentTermsVersionId))
      .where(
        and(
          or(eq(trades.buyerUserId, userId), eq(trades.sellerUserId, userId)),
          or(eq(trades.initiatorUserId, userId), notInArray(trades.status, HIDDEN_FROM_COUNTERPARTY)),
          input.state === 'OPEN' ? notInArray(trades.status, [...TERMINAL_STATUSES]) : undefined,
          input.state === 'CLOSED' ? inArray(trades.status, [...TERMINAL_STATUSES]) : undefined,
          after
            ? sql`(${trades.updatedAt}, ${trades.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(trades.updatedAt), desc(trades.id))
      .limit(input.limit + 1);

    const page = cursorPage(rows, input.limit, (row) =>
      tradeListCursor({ cursorTs: row.cursorTs, id: row.trade.id }, input.state),
    );
    const ids = page.items.map((row) => row.trade.id);

    const [pendingDelivery, pendingInspection] = ids.length
      ? await Promise.all([
          tx
            .select({ tradeId: deliveryExtensionRequests.tradeId })
            .from(deliveryExtensionRequests)
            .where(
              and(
                inArray(deliveryExtensionRequests.tradeId, ids),
                eq(deliveryExtensionRequests.status, 'PENDING'),
              ),
            ),
          tx
            .select({ tradeId: inspectionExtensionRequests.tradeId })
            .from(inspectionExtensionRequests)
            .where(
              and(
                inArray(inspectionExtensionRequests.tradeId, ids),
                eq(inspectionExtensionRequests.status, 'PENDING'),
              ),
            ),
        ])
      : [[], []];
    const delivery = new Set(pendingDelivery.map((r) => r.tradeId));
    const inspection = new Set(pendingInspection.map((r) => r.tradeId));

    const others = page.items.flatMap((row) => {
      const other = roleOf(row.trade, userId) === 'BUYER' ? row.trade.sellerUserId : row.trade.buyerUserId;
      return other ? [other] : [];
    });
    const displays = await deps.displays(tx, [...new Set(others)]);

    const items = page.items.map((row): TradeListItem => {
      const { trade } = row;
      const yourRole = roleOf(trade, userId);
      const other = yourRole === 'BUYER' ? trade.sellerUserId : trade.buyerUserId;
      const awaiting =
        trade.status === 'AWAITING_ACCEPTANCE' && row.proposedByUserId
          ? row.proposedByUserId === userId
            ? ('COUNTERPARTY' as const)
            : ('YOU' as const)
          : null;
      const attention: TradeAttention | null = attentionFor({
        status: trade.status,
        yourRole,
        awaiting,
        pendingDeliveryExtension: delivery.has(trade.id),
        pendingInspectionExtension: inspection.has(trade.id),
      });
      return {
        id: trade.id,
        tradeCode: trade.tradeCode,
        status: trade.status,
        statusRevision: trade.statusRevision,
        yourRole,
        initiatorRole: trade.initiatorRole,
        awaiting,
        attention,
        counterparty: other ? (displays.get(other) ?? null) : null,
        item: {
          title: itemTitle(row.itemSpec),
          categoryCode: row.categoryCode,
          categoryName: row.categoryName,
        },
        currency: 'NGN',
        itemAmountMinor: row.itemAmountMinor === null ? null : row.itemAmountMinor.toString(),
        buyerTotalMinor: trade.buyerTotalMinor === null ? null : trade.buyerTotalMinor.toString(),
        sentAt: trade.sentAt?.toISOString() ?? null,
        createdAt: trade.createdAt.toISOString(),
        updatedAt: trade.updatedAt.toISOString(),
      };
    });
    return { items, nextCursor: page.nextCursor };
  });
}

// ---------------------------------------------------------------------------
// By code
// ---------------------------------------------------------------------------

/**
 * Resolves a trade code for the people who may hold one, and for nobody else.
 *
 * - A party of record (buyer or seller; the initiator is always one) gets `PARTY` and the trade as
 *   `GET /trades/:id` shows it.
 * - The NAMED invitee gets `INVITEE`: the trade is still `PENDING_COUNTERPARTY` and the invitation on it
 *   was claimed BY THIS USER (identity claims an invitation when the person signs up or signs in with
 *   the address it was sent to). They see a preview with no addresses and no fees; the response's `id`
 *   is what `POST /trades/:id/claim` takes.
 * - Everyone else gets `tradeNotFoundError()`, the SAME error for a code that does not exist, one that
 *   is not theirs, and one whose invitation is claimed by someone else, so this is not an oracle for
 *   which trade codes exist. The lookup is one query whichever of those it is, so the three also cost
 *   the same.
 *
 * A trade code identifies a trade, it never authorises access to one (tradeCode.ts); this function is
 * what keeps that true.
 */
export async function resolveTradeByCode(
  deps: ListDeps,
  input: { userId: string; tradeCode: string },
): Promise<TradeByCodeResponse> {
  return deps.db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        trade: trades,
        invitationClaimedBy: partyInvitations.claimedByUserId,
        invitationStatus: partyInvitations.status,
      })
      .from(trades)
      .leftJoin(partyInvitations, eq(partyInvitations.id, trades.counterpartyInvitationId))
      .where(eq(trades.tradeCode, input.tradeCode));
    if (!found) throw tradeNotFoundError();
    const { trade } = found;

    const isParty =
      trade.buyerUserId === input.userId ||
      trade.sellerUserId === input.userId ||
      trade.initiatorUserId === input.userId;
    const isNamedInvitee =
      !isParty &&
      trade.status === 'PENDING_COUNTERPARTY' &&
      found.invitationStatus === 'CLAIMED' &&
      found.invitationClaimedBy === input.userId;
    if (!isParty && !isNamedInvitee) throw tradeNotFoundError();

    if (isParty) {
      const role: TradeInitiatorRole =
        trade.buyerUserId === input.userId
          ? 'BUYER'
          : trade.sellerUserId === input.userId
            ? 'SELLER'
            : trade.initiatorRole;
      const view = await buildView(tx, trade, input.userId, role);
      const other = role === 'BUYER' ? trade.sellerUserId : trade.buyerUserId;
      return {
        access: 'PARTY',
        trade: view,
        counterparty: other ? await displayOf(deps, tx, other) : null,
      };
    }

    const inviteeRole: TradeInitiatorRole = trade.initiatorRole === 'BUYER' ? 'SELLER' : 'BUYER';
    return {
      access: 'INVITEE',
      trade: previewForInvitee(await buildView(tx, trade, input.userId, inviteeRole)),
      counterparty: await displayOf(deps, tx, trade.initiatorUserId),
    };
  });
}

const displayOf = async (
  deps: ListDeps,
  tx: Parameters<ListDeps['displays']>[0],
  userId: string,
): Promise<CounterpartyDisplay | null> => (await deps.displays(tx, [userId])).get(userId) ?? null;

/**
 * What a person invited to a trade may see before they have taken their side: the proposal, not the
 * initiator's address or the fee snapshot, and the action asked of them is to claim. The initiator's
 * address is released only to a party of record.
 */
export function previewForInvitee(view: TradeView): TradeView {
  return {
    ...view,
    awaiting: 'YOU',
    terms: view.terms && { ...view.terms, deliveryAddress: null, shipsFromAddress: null },
    fees: null,
  };
}
