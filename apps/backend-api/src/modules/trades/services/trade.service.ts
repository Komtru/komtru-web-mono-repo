// The trade as a person sees it, and the two ways out of a proposal that need no new terms: decline
// (SD1) and cancel (CT1). The shared helpers the proposal service builds on live here too, because
// they are about a trade and its terms rather than about proposing.
//
// Every action is idempotent in the same way: if the trade is already where the action would put
// it, and the same person put it there, the answer is the trade as it stands. A double-tapped
// button or a retried request therefore never turns into a 409 the user has to read. Routes are
// also `retryable: true`, so the platform's Idempotency-Key replays the stored response first.
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../../../platform/errors.js';
import type { Tx } from '../../../platform/events/publish.js';
import { cancelInvitation, userAddresses } from '../../identity/index.js';
import { addressRequiredError, notYourTurnError, tradeNotFoundError } from '../domain/errors.js';
import type { TradeInitiatorRole } from '../domain/eligibility.js';
import { sideOf, type ProofCheck } from '../domain/proposal.js';
import type { TradeStatus } from '../domain/stateMachine.js';
import { tradeDeepLink } from '../infrastructure/notifications.js';
import { tradeActivity } from '../infrastructure/postgres/schema/audit.js';
import { tradeProofMedia } from '../infrastructure/postgres/schema/proof.js';
import { tradeTermsVersions } from '../infrastructure/postgres/schema/terms.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { applyTransition } from '../infrastructure/postgres/transitions.js';
import type { TradeDeps } from './ports.js';

export type TradeRow = typeof trades.$inferSelect;
export type TermsRow = typeof tradeTermsVersions.$inferSelect;

/** What a version stores for an address: everything a courier and a Park hub need (design §7.8). */
export interface AddressSnapshot {
  street: string;
  landmark: string;
  recipient: string;
  phone: string;
  state_id: string;
  city_id: string;
  label: string;
  source_address_id: string;
}

export async function loadTrade(tx: Tx, tradeId: string, lock = false): Promise<TradeRow> {
  const query = tx.select().from(trades).where(eq(trades.id, tradeId));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw tradeNotFoundError();
  return row;
}

export async function loadTerms(tx: Tx, versionId: string | null): Promise<TermsRow> {
  if (!versionId) throw new Error('trades: a trade past DRAFT always has a current terms version');
  const [row] = await tx.select().from(tradeTermsVersions).where(eq(tradeTermsVersions.id, versionId));
  if (!row) throw new Error(`trades: terms version ${versionId} is missing`);
  return row;
}

/** A stranger and a missing trade look the same: the endpoint is not an existence oracle. */
export function requireParty(trade: TradeRow, userId: string): TradeInitiatorRole {
  const side = sideOf(trade, userId);
  if (side) return side;
  // Before binding, the initiator is the only person on the trade.
  if (trade.initiatorUserId === userId) return trade.initiatorRole;
  throw tradeNotFoundError();
}

export async function recordActivity(
  tx: Tx,
  input: {
    tradeId: string;
    type: typeof tradeActivity.$inferInsert.type;
    actorType: 'BUYER' | 'SELLER' | 'SYSTEM';
    actorId?: string;
    termsVersionId?: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(tradeActivity).values({
    tradeId: input.tradeId,
    type: input.type,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    termsVersionId: input.termsVersionId ?? null,
    summary: input.summary ?? null,
    metadata: input.metadata ?? null,
  });
}

/**
 * The saved address as a snapshot, or 422 ADDRESS_REQUIRED. "Usable" is identity's definition
 * (T-042): the caller's own, not archived, in a city still active in the geo catalog. A foreign or
 * archived id gets the same answer as none at all, so it cannot be used to probe other people's
 * address ids.
 */
export async function snapshotAddress(
  deps: Pick<TradeDeps, 'cities'>,
  tx: Tx,
  userId: string,
  addressId: string | undefined,
  side: TradeInitiatorRole,
): Promise<AddressSnapshot> {
  if (!addressId) throw addressRequiredError(side);
  const [row] = await tx
    .select()
    .from(userAddresses)
    .where(
      and(
        eq(userAddresses.id, addressId),
        eq(userAddresses.userId, userId),
        isNull(userAddresses.archivedAt),
      ),
    );
  if (!row) throw addressRequiredError(side);
  const [city] = await deps.cities(tx, [row.cityId]);
  if (!city?.active) throw addressRequiredError(side);
  return {
    street: row.streetLine,
    landmark: row.landmark ?? '',
    recipient: row.recipientName,
    phone: row.recipientPhone,
    state_id: row.stateId,
    city_id: row.cityId,
    label: row.label,
    source_address_id: row.id,
  };
}

/** The side of a version an address belongs to: delivery is the buyer's, ships-from the seller's. */
export const addressOf = (terms: TermsRow, side: TradeInitiatorRole): AddressSnapshot | null =>
  (side === 'BUYER' ? terms.deliveryAddress : terms.shipsFromAddress) as AddressSnapshot | null;

export async function proofFileIds(tx: Tx, tradeId: string): Promise<string[]> {
  const rows = await tx
    .select({ fileId: tradeProofMedia.fileId })
    .from(tradeProofMedia)
    .where(eq(tradeProofMedia.tradeId, tradeId));
  return rows.map((row) => row.fileId);
}

/**
 * After a trade ends without funding (declined, cancelled, expired) the buyer's view of the seller's
 * proof closes again. The privacy-safe default: the buyer only ever saw it to decide, and a trade
 * that did not happen is no reason for them to keep it. Run after the transition commits; the
 * revoke is idempotent, so replays of the action heal a failed one.
 */
export async function revokeProofFromBuyer(
  deps: Pick<TradeDeps, 'db' | 'revokeProofAccess'>,
  tradeId: string,
): Promise<void> {
  const { trade, files } = await deps.db.transaction(async (tx) => ({
    trade: await loadTrade(tx, tradeId),
    files: await proofFileIds(tx, tradeId),
  }));
  if (!trade.buyerUserId || files.length === 0) return;
  await deps.revokeProofAccess(files, trade.buyerUserId);
}

export type ProofFailure = Exclude<ProofCheck, { ok: true }>;

/** Turn answers: only the party who did not write the current version may accept, decline or counter. */
export function assertTheirTurn(terms: TermsRow, userId: string): void {
  if (terms.proposedByUserId === userId) throw notYourTurnError();
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

const asString = (value: bigint | null): string | null => (value === null ? null : value.toString());

export type TradeView = {
  id: string;
  tradeCode: string;
  /**
   * `https://app.komtru.com/trades/<code>`: what an initiator can share. It is only the code in a link, so
   * holding it opens nothing: `GET /trades/by-code/:code` answers a party or the named invitee, and
   * everyone else the same as a code that does not exist. No token scheme (see the plan).
   */
  shareUrl: string;
  status: TradeStatus;
  statusRevision: number;
  initiatorRole: TradeInitiatorRole;
  yourRole: TradeInitiatorRole;
  /** Who has to act: the other party answers a proposal, nobody is waiting on a closed trade. */
  awaiting: 'YOU' | 'COUNTERPARTY' | null;
  terms: {
    versionId: string;
    versionNumber: number;
    proposedByRole: TradeInitiatorRole;
    itemAmountMinor: string;
    currency: 'NGN';
    itemSpec: unknown;
    inspectionWindowHours: number;
    deliveryGraceHours: number;
    deliveryAddress: unknown;
    shipsFromAddress: unknown;
    createdAt: string;
  } | null;
  fees: {
    scheduleVersion: string;
    itemAmountMinor: string;
    buyerProtectionFeeMinor: string;
    buyerTotalMinor: string;
    commissionMinor: string;
    sellerProceedsMinor: string;
  } | null;
  proofMediaCount: number;
  sentAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
};

export async function viewTrade(tx: Tx, trade: TradeRow, userId: string): Promise<TradeView> {
  return buildView(tx, trade, userId, requireParty(trade, userId));
}

/** The view for a caller whose role the CALLER of this function has already established. */
export async function buildView(
  tx: Tx,
  trade: TradeRow,
  userId: string,
  role: TradeInitiatorRole,
): Promise<TradeView> {
  const terms = trade.currentTermsVersionId ? await loadTerms(tx, trade.currentTermsVersionId) : null;
  const proof = await proofFileIds(tx, trade.id);
  const open = trade.status === 'AWAITING_ACCEPTANCE';
  return {
    id: trade.id,
    tradeCode: trade.tradeCode,
    shareUrl: tradeDeepLink(trade.tradeCode),
    status: trade.status,
    statusRevision: trade.statusRevision,
    initiatorRole: trade.initiatorRole,
    yourRole: role,
    awaiting: open && terms ? (terms.proposedByUserId === userId ? 'COUNTERPARTY' : 'YOU') : null,
    terms: terms && {
      versionId: terms.id,
      versionNumber: terms.versionNumber,
      proposedByRole: terms.proposedByRole,
      itemAmountMinor: terms.itemAmountMinor.toString(),
      currency: 'NGN',
      itemSpec: terms.itemSpec,
      inspectionWindowHours: terms.inspectionWindowHours,
      deliveryGraceHours: terms.deliveryGraceHours,
      deliveryAddress: terms.deliveryAddress,
      shipsFromAddress: terms.shipsFromAddress,
      createdAt: terms.createdAt.toISOString(),
    },
    fees: trade.feeScheduleVersion
      ? {
          scheduleVersion: trade.feeScheduleVersion,
          itemAmountMinor: asString(trade.itemAmountMinor) ?? '0',
          buyerProtectionFeeMinor: asString(trade.buyerProtectionFeeMinor) ?? '0',
          buyerTotalMinor: asString(trade.buyerTotalMinor) ?? '0',
          commissionMinor: asString(trade.commissionMinor) ?? '0',
          sellerProceedsMinor: asString(trade.sellerProceedsMinor) ?? '0',
        }
      : null,
    proofMediaCount: proof.length,
    sentAt: trade.sentAt?.toISOString() ?? null,
    acceptedAt: trade.acceptedAt?.toISOString() ?? null,
    createdAt: trade.createdAt.toISOString(),
  };
}

export async function getTrade(deps: Pick<TradeDeps, 'db'>, input: { userId: string; tradeId: string }) {
  return deps.db.transaction(async (tx) => viewTrade(tx, await loadTrade(tx, input.tradeId), input.userId));
}

// ---------------------------------------------------------------------------
// SD1: decline
// ---------------------------------------------------------------------------

export async function declineTrade(
  deps: Pick<TradeDeps, 'db' | 'revokeProofAccess'>,
  input: { userId: string; tradeId: string; reason: string },
): Promise<TradeView> {
  const view = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    const role = requireParty(trade, input.userId);
    if (trade.status === 'DECLINED' && trade.statusActorId === input.userId) {
      return viewTrade(tx, trade, input.userId);
    }
    if (trade.status === 'AWAITING_ACCEPTANCE') {
      assertTheirTurn(await loadTerms(tx, trade.currentTermsVersionId), input.userId);
    }
    // A decline without a reason leaves the other party guessing, and the reason is the point of
    // SD1: it is shown to the proposer and kept in the trade's history.
    const reason = input.reason.trim();
    if (reason.length < 3) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Say why you are declining', undefined, [
        { path: 'reason', message: 'A reason is required' },
      ]);
    }
    await applyTransition(tx, {
      tradeId: trade.id,
      action: 'DECLINE',
      to: 'DECLINED',
      actor: { type: role, id: input.userId },
      reason,
    });
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'PROPOSAL_DECLINED',
      actorType: role,
      actorId: input.userId,
      ...(trade.currentTermsVersionId ? { termsVersionId: trade.currentTermsVersionId } : {}),
      summary: reason,
    });
    return viewTrade(tx, await loadTrade(tx, trade.id), input.userId);
  });
  await revokeProofFromBuyer(deps, input.tradeId);
  return view;
}

// ---------------------------------------------------------------------------
// CT1: cancel before funding
// ---------------------------------------------------------------------------

export async function cancelTrade(
  deps: Pick<TradeDeps, 'db' | 'revokeProofAccess'>,
  input: { userId: string; tradeId: string; reason?: string },
): Promise<TradeView> {
  const view = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    const role = requireParty(trade, input.userId);
    if (trade.status === 'CANCELLED') return viewTrade(tx, trade, input.userId);

    await applyTransition(tx, {
      tradeId: trade.id,
      action: 'CANCEL',
      to: 'CANCELLED',
      actor: { type: role, id: input.userId },
      ...(input.reason ? { reason: input.reason } : {}),
      set: { cancellationReason: role === 'BUYER' ? 'BUYER_WITHDREW' : 'SELLER_WITHDREW' },
    });
    // Nobody has claimed the invitation yet and nobody now can: withdraw it with the trade.
    if (trade.status === 'PENDING_COUNTERPARTY' && trade.counterpartyInvitationId) {
      await cancelInvitation(tx, trade.counterpartyInvitationId);
    }
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: role,
      actorId: input.userId,
      summary: input.reason ? `Cancelled: ${input.reason}` : 'Cancelled before funding',
      metadata: { event: 'CANCELLED', fromStatus: trade.status },
    });
    return viewTrade(tx, await loadTrade(tx, trade.id), input.userId);
  });
  await revokeProofFromBuyer(deps, input.tradeId);
  return view;
}
