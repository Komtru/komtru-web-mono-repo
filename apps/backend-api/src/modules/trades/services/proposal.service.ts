// The proposal flow (T-061): preview, create, send, counter-propose, accept, and the two edges that
// bring an invited non-user in (claim) or let the invitation lapse (expire). Decline and cancel are
// in trade.service.ts.
//
// Every state change goes through `applyTransition`, so the guard, the state-change log and the
// `trades.trade.state_changed` event come for free and in the same transaction. Each step also
// writes a `trade_activity` row, which is what the timeline shows.
//
// Where a rule needs to *record* a refusal (a merchant naming or taking the buyer side), the check
// runs in its own short transaction and the error is thrown after it commits: throwing inside the
// transaction that wrote the evidence would roll the evidence back with it.
import type { Kobo } from '@komtru/shared-types';
import { eq } from 'drizzle-orm';
import { ApiError } from '../../../platform/errors.js';
import type { Tx } from '../../../platform/events/publish.js';
import {
  createInvitation,
  hasUsableAddress,
  lookupKeyForEmail,
  lookupKeyForPhone,
  lookupKeyForUsername,
  lookupParty,
  partyInvitations,
  users,
  type LookupKey,
} from '../../identity/index.js';
import { validateItemSpec } from '../../config/index.js';
import { canActAsBuyer, type TradeInitiatorRole } from '../domain/eligibility.js';
import {
  addressRequiredError,
  itemSpecInvalidError,
  merchantCannotBuyError,
  proofMediaRequiredError,
  selfTradeError,
  tradeNotFoundError,
} from '../domain/errors.js';
import { feeSnapshotColumns } from '../domain/feeSnapshot.js';
import { checkProofMedia, otherRole, type ProofRequirement } from '../domain/proposal.js';
import type { BuyerPath } from '../domain/eligibility.js';
import { tradeProofMedia } from '../infrastructure/postgres/schema/proof.js';
import { tradeTermsVersions } from '../infrastructure/postgres/schema/terms.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { readTradePrincipal, recordEligibilityBlock } from '../infrastructure/postgres/principals.js';
import { withTradeCode } from '../infrastructure/postgres/tradeCodes.js';
import { applyTransition } from '../infrastructure/postgres/transitions.js';
import type { TradeDeps, TradeStandard } from './ports.js';
import {
  addressOf,
  assertTheirTurn,
  loadTerms,
  loadTrade,
  proofFileIds,
  recordActivity,
  requireParty,
  snapshotAddress,
  viewTrade,
  type AddressSnapshot,
  type TradeRow,
  type TradeView,
} from './trade.service.js';

const MAX_PROOF_FILES = 20;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * The buyer gate for somebody else's account or the caller's own, recorded and then raised once the
 * evidence has committed. `actorId` is who the evidence is filed against: the person trying.
 */
async function refuseMerchantBuyer(
  deps: Pick<TradeDeps, 'db'>,
  input: { buyerUserId: string; actorId: string; path: BuyerPath; tradeId?: string },
): Promise<void> {
  const blocked = await deps.db.transaction(async (tx) => {
    const principal = await readTradePrincipal(tx, input.buyerUserId);
    if (canActAsBuyer(principal)) return false;
    await recordEligibilityBlock(tx, {
      ...(input.tradeId ? { tradeId: input.tradeId } : {}),
      gate: 'MERCHANT_CANNOT_BUY',
      path: input.path,
      actorId: input.actorId,
    });
    return true;
  });
  if (blocked) throw merchantCannotBuyError(input.path);
}

const proofRequirement = (standard: TradeStandard): ProofRequirement => standard.proofMedia;

/** Seller-uploaded, finished, private-to-the-case files only: nobody else's media, no public ones. */
async function attachProof(
  deps: Pick<TradeDeps, 'proofFiles'>,
  tx: Tx,
  trade: { id: string },
  sellerUserId: string,
  fileIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(fileIds)];
  if (unique.length === 0) return;
  if (unique.length > MAX_PROOF_FILES) {
    throw new ApiError(422, 'VALIDATION_FAILED', `Attach at most ${MAX_PROOF_FILES} files`);
  }
  const found = await deps.proofFiles(tx, unique);
  const usable = new Map(
    found
      .filter((f) => f.uploaderUserId === sellerUserId && f.visibility === 'PRIVATE_CASE')
      .map((f) => [f.id, f]),
  );
  const rejected = unique.filter((id) => !usable.has(id));
  if (rejected.length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Some proof files cannot be used',
      'Proof must be your own finished uploads.',
      rejected.map((id) => ({ path: 'proofFileIds', message: `${id} is not an usable upload` })),
    );
  }
  await tx
    .insert(tradeProofMedia)
    .values(unique.map((fileId) => ({ tradeId: trade.id, fileId, attachedByUserId: sellerUserId })))
    .onConflictDoNothing();
}

/** W1: the gate in front of PENDING_PAYMENT, and in front of a seller-initiated send. */
async function assertSellerProof(
  deps: Pick<TradeDeps, 'proofFiles'>,
  tx: Tx,
  tradeId: string,
  standard: TradeStandard,
): Promise<void> {
  const files = await deps.proofFiles(tx, await proofFileIds(tx, tradeId));
  const check = checkProofMedia(proofRequirement(standard), files);
  if (!check.ok) throw proofMediaRequiredError(check);
}

function assertItem(standard: TradeStandard, itemSpec: Record<string, unknown>, itemAmountMinor: Kobo): void {
  if (itemAmountMinor <= 0n) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'The price must be more than zero', undefined, [
      { path: 'itemAmountMinor', message: 'Enter a price' },
    ]);
  }
  const check = validateItemSpec(standard, itemSpec);
  if (!check.ok) throw itemSpecInvalidError(check.missing);
}

const sellerKindOf = (status: string | null) => (status === 'ACTIVE' ? 'MERCHANT' : 'CASUAL');

// ---------------------------------------------------------------------------
// Z3: live contract preview
// ---------------------------------------------------------------------------

export interface PreviewInput {
  userId: string;
  role: TradeInitiatorRole;
  categoryCode: string;
  itemAmountMinor?: Kobo;
}

/**
 * What the contract screen shows while the initiator types: which sides they may take, what the
 * category requires, and the buyer's total at the live schedule. Nothing is stored. When the
 * initiator is the seller the seller kind is known; when they are the buyer it is not yet, so both
 * are shown rather than guessing which the counterparty will turn out to be.
 */
export async function previewProposal(deps: TradeDeps, input: PreviewInput) {
  const standard = await deps.standards.current(input.categoryCode);
  const principal = await deps.db.transaction((tx) => readTradePrincipal(tx, input.userId));
  const allowedRoles: TradeInitiatorRole[] = canActAsBuyer(principal) ? ['BUYER', 'SELLER'] : ['SELLER'];
  const amount =
    input.itemAmountMinor !== undefined && input.itemAmountMinor > 0n ? input.itemAmountMinor : null;
  const kinds =
    input.role === 'SELLER' ? [sellerKindOf(principal.merchantCapabilityStatus)] : ['CASUAL', 'MERCHANT'];
  return {
    allowedRoles,
    standard: {
      categoryCode: standard.categoryCode,
      versionNumber: standard.versionNumber,
      inspectionWindowHours: standard.inspectionWindowHours,
      itemSpecFields: standard.itemSpecFields,
      proofMedia: standard.proofMedia,
      deliveryDeadlineDays: standard.deliveryDeadlineDays,
    },
    fees: amount
      ? kinds.map((kind) => ({
          sellerKind: kind,
          snapshot: deps.snapshotFees(amount, kind as 'CASUAL' | 'MERCHANT'),
        }))
      : [],
  };
}

// ---------------------------------------------------------------------------
// Create (a draft with its first terms)
// ---------------------------------------------------------------------------

export interface CreateProposalInput {
  userId: string;
  role: TradeInitiatorRole;
  categoryCode: string;
  itemAmountMinor: Kobo;
  itemSpec: Record<string, unknown>;
  addressId: string;
  proofFileIds?: string[];
}

export async function createProposal(deps: TradeDeps, input: CreateProposalInput): Promise<TradeView> {
  if (input.role === 'BUYER') {
    await refuseMerchantBuyer(deps, {
      buyerUserId: input.userId,
      actorId: input.userId,
      path: 'CREATE_TRADE_AS_BUYER',
    });
  }
  const standard = await deps.standards.current(input.categoryCode);
  assertItem(standard, input.itemSpec, input.itemAmountMinor);
  const graceHours = await deps.graceHours();

  return deps.db.transaction(async (tx) => {
    const address = await snapshotAddress(deps, tx, input.userId, input.addressId, input.role);

    const trade = await withTradeCode(tx, async (tradeCode) => {
      const [row] = await tx
        .insert(trades)
        .values({
          tradeCode,
          initiatorUserId: input.userId,
          initiatorRole: input.role,
          ...(input.role === 'BUYER' ? { buyerUserId: input.userId } : { sellerUserId: input.userId }),
          categoryId: standard.categoryId,
          tradeStandardVersion: standard.versionNumber,
          inspectionWindowHours: standard.inspectionWindowHours,
          deliveryGraceHours: graceHours,
        })
        .returning();
      if (!row) throw new Error('createProposal: the insert returned no row');
      return row;
    });

    const [terms] = await tx
      .insert(tradeTermsVersions)
      .values({
        tradeId: trade.id,
        versionNumber: 1,
        proposedByUserId: input.userId,
        proposedByRole: input.role,
        itemAmountMinor: input.itemAmountMinor,
        itemSpec: input.itemSpec,
        inspectionWindowHours: standard.inspectionWindowHours,
        deliveryGraceHours: graceHours,
        ...(input.role === 'BUYER' ? { deliveryAddress: address } : { shipsFromAddress: address }),
      })
      .returning();
    if (!terms) throw new Error('createProposal: the terms insert returned no row');
    await tx.update(trades).set({ currentTermsVersionId: terms.id }).where(eq(trades.id, trade.id));

    if (input.role === 'SELLER' && input.proofFileIds?.length) {
      await attachProof(deps, tx, trade, input.userId, input.proofFileIds);
    }
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: input.role,
      actorId: input.userId,
      termsVersionId: terms.id,
      summary: 'Draft created',
    });
    return viewTrade(tx, await loadTrade(tx, trade.id), input.userId);
  });
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface SendInput {
  userId: string;
  tradeId: string;
  counterparty: { channel: LookupKey['channel']; value: string };
  ip?: string | null;
  proofFileIds?: string[];
}

const keyFor = (counterparty: SendInput['counterparty']): LookupKey | null =>
  counterparty.channel === 'USERNAME'
    ? lookupKeyForUsername(counterparty.value)
    : counterparty.channel === 'EMAIL'
      ? lookupKeyForEmail(counterparty.value)
      : lookupKeyForPhone(counterparty.value);

type Resolved = { kind: 'USER'; userId: string } | { kind: 'INVITED'; invitationId: string };

async function resolveCounterparty(
  deps: TradeDeps,
  input: SendInput,
  trade: TradeRow,
  counterpartyRole: TradeInitiatorRole,
): Promise<Resolved> {
  const key = keyFor(input.counterparty);
  if (!key) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'That is not a valid username, email or phone', undefined, [
      { path: 'counterparty', message: 'Check the details and try again' },
    ]);
  }
  const found = await lookupParty(deps.party, { actorUserId: input.userId, ip: input.ip ?? null, key });
  if (found.found) {
    const [person] = await deps.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.publicId, found.party.publicId));
    if (!person) throw tradeNotFoundError();
    return { kind: 'USER', userId: person.id };
  }
  if (!found.canInvite) {
    // A username that matches nobody: usernames cannot be invited, only found.
    throw new ApiError(404, 'NOT_FOUND', 'No one has that username');
  }
  const invited = await createInvitation(deps.invitations, {
    inviterUserId: input.userId,
    channel: input.counterparty.channel === 'EMAIL' ? 'EMAIL' : 'PHONE',
    destination: input.counterparty.value,
    intendedRole: counterpartyRole,
    context: { type: 'TRADE', id: trade.id },
  });
  if (invited.outcome === 'SELF') throw selfTradeError();
  if (invited.outcome !== 'CREATED') {
    throw new ApiError(422, 'VALIDATION_FAILED', 'That is not a valid email or phone', undefined, [
      { path: 'counterparty', message: 'Check the details and try again' },
    ]);
  }
  return { kind: 'INVITED', invitationId: invited.invitationId };
}

export async function sendProposal(deps: TradeDeps, input: SendInput): Promise<TradeView> {
  const draft = await deps.db.transaction((tx) => loadTrade(tx, input.tradeId));
  if (draft.initiatorUserId !== input.userId) throw tradeNotFoundError();
  // Idempotent replay: already sent means the answer is the trade as it stands.
  if (draft.status !== 'DRAFT') {
    if (draft.sentAt) {
      const view = await deps.db.transaction(async (tx) => viewTrade(tx, draft, input.userId));
      // The grant runs after the send commits, so a failure there leaves a sent trade without it:
      // the retry is where it heals (the grant is idempotent).
      await grantProofToBuyer(deps, input.tradeId);
      return view;
    }
    throw new ApiError(409, 'INVALID_TRANSITION', 'That step is not available on this trade');
  }

  const counterpartyRole = otherRole(draft.initiatorRole);
  const resolved = await resolveCounterparty(deps, input, draft, counterpartyRole);

  if (resolved.kind === 'USER') {
    if (resolved.userId === input.userId) throw selfTradeError();
    // Rejected before send: a certified merchant cannot be named as the buyer.
    if (counterpartyRole === 'BUYER') {
      await refuseMerchantBuyer(deps, {
        buyerUserId: resolved.userId,
        actorId: input.userId,
        path: 'NAMED_AS_BUYER',
        tradeId: draft.id,
      });
    }
  }

  const standard = await deps.standards.pinned(requireCategory(draft), requireVersion(draft));

  const result = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (trade.status !== 'DRAFT') return viewTrade(tx, trade, input.userId);
    const terms = await loadTerms(tx, trade.currentTermsVersionId);

    // The initiator's own side must still be usable: an address archived since the draft was made
    // cannot be shipped to, and the client sends the user to add one.
    const own = addressOf(terms, trade.initiatorRole);
    await snapshotAddress(deps, tx, input.userId, own?.source_address_id, trade.initiatorRole);

    if (trade.initiatorRole === 'SELLER') {
      if (input.proofFileIds?.length) await attachProof(deps, tx, trade, input.userId, input.proofFileIds);
      await assertSellerProof(deps, tx, trade.id, standard);
    }

    const counterpartySet =
      resolved.kind === 'USER'
        ? {
            ...(counterpartyRole === 'BUYER'
              ? { buyerUserId: resolved.userId }
              : { sellerUserId: resolved.userId }),
            counterpartyBoundAt: new Date(),
          }
        : { counterpartyInvitationId: resolved.invitationId };

    await applyTransition(tx, {
      tradeId: trade.id,
      action: 'SEND',
      to: resolved.kind === 'USER' ? 'AWAITING_ACCEPTANCE' : 'PENDING_COUNTERPARTY',
      actor: { type: trade.initiatorRole, id: input.userId },
      set: counterpartySet,
    });
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'PROPOSAL_SENT',
      actorType: trade.initiatorRole,
      actorId: input.userId,
      termsVersionId: terms.id,
      metadata: { counterparty: resolved.kind },
    });
    return viewTrade(tx, await loadTrade(tx, trade.id), input.userId);
  });

  await grantProofToBuyer(deps, input.tradeId);
  return result;
}

const requireCategory = (trade: TradeRow): string => {
  if (!trade.categoryId) throw new Error(`trades: trade ${trade.id} has no category`);
  return trade.categoryId;
};
const requireVersion = (trade: TradeRow): number => {
  if (trade.tradeStandardVersion === null)
    throw new Error(`trades: trade ${trade.id} has no standard version`);
  return trade.tradeStandardVersion;
};

/** After commit and only once a buyer exists: the buyer may open the seller's proof (M20 PRIVATE_CASE). */
async function grantProofToBuyer(deps: TradeDeps, tradeId: string): Promise<void> {
  const { trade, files } = await deps.db.transaction(async (tx) => ({
    trade: await loadTrade(tx, tradeId),
    files: await proofFileIds(tx, tradeId),
  }));
  if (!trade.buyerUserId || files.length === 0) return;
  await deps.grantProofAccess(files, trade.buyerUserId, trade.tradeCode);
}

// ---------------------------------------------------------------------------
// W2 / BR1: counter-proposal
// ---------------------------------------------------------------------------

export interface CounterInput {
  userId: string;
  tradeId: string;
  /** The `statusRevision` the client last saw; a stale one is a 409 rather than a lost update. */
  expectedRevision: number;
  itemAmountMinor?: Kobo;
  itemSpec?: Record<string, unknown>;
  addressId?: string;
  proofFileIds?: string[];
}

export async function counterPropose(deps: TradeDeps, input: CounterInput): Promise<TradeView> {
  const result = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    const role = requireParty(trade, input.userId);
    const current = await loadTerms(tx, trade.currentTermsVersionId);
    if (trade.status === 'AWAITING_ACCEPTANCE') assertTheirTurn(current, input.userId);

    const standard = await deps.standards.pinned(requireCategory(trade), requireVersion(trade));
    const amount = input.itemAmountMinor ?? current.itemAmountMinor;
    const spec = input.itemSpec ?? (current.itemSpec as Record<string, unknown>);
    assertItem(standard, spec, amount);

    // Changing either address is a term change; the counterparty's own side is never theirs to change.
    const ownBefore = addressOf(current, role);
    const own =
      input.addressId || !ownBefore
        ? await snapshotAddress(deps, tx, input.userId, input.addressId, role)
        : ownBefore;

    const version = await insertNextVersion(tx, current, {
      proposedByUserId: input.userId,
      proposedByRole: role,
      itemAmountMinor: amount,
      itemSpec: spec,
      ...(role === 'BUYER' ? { deliveryAddress: own } : { shipsFromAddress: own }),
    });
    if (role === 'SELLER' && input.proofFileIds?.length) {
      await attachProof(deps, tx, trade, input.userId, input.proofFileIds);
    }

    await applyTransition(tx, {
      tradeId: trade.id,
      action: 'COUNTER_PROPOSE',
      to: 'AWAITING_ACCEPTANCE',
      actor: { type: role, id: input.userId },
      expectedRevision: input.expectedRevision,
      set: { currentTermsVersionId: version.id },
    });
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'COUNTER_PROPOSED',
      actorType: role,
      actorId: input.userId,
      termsVersionId: version.id,
      metadata: { versionNumber: version.versionNumber },
    });
    return viewTrade(tx, await loadTrade(tx, trade.id), input.userId);
  });
  await grantProofToBuyer(deps, input.tradeId);
  return result;
}

/** Supersedes the current version and writes the next; the old row is never edited otherwise. */
async function insertNextVersion(
  tx: Tx,
  current: typeof tradeTermsVersions.$inferSelect,
  change: {
    proposedByUserId: string;
    proposedByRole: TradeInitiatorRole;
    itemAmountMinor: Kobo;
    itemSpec: Record<string, unknown>;
    deliveryAddress?: AddressSnapshot;
    shipsFromAddress?: AddressSnapshot;
  },
) {
  await tx
    .update(tradeTermsVersions)
    .set({ supersededAt: new Date() })
    .where(eq(tradeTermsVersions.id, current.id));
  const [version] = await tx
    .insert(tradeTermsVersions)
    .values({
      tradeId: current.tradeId,
      versionNumber: current.versionNumber + 1,
      proposedByUserId: change.proposedByUserId,
      proposedByRole: change.proposedByRole,
      itemAmountMinor: change.itemAmountMinor,
      itemSpec: change.itemSpec,
      inspectionWindowHours: current.inspectionWindowHours,
      deliveryGraceHours: current.deliveryGraceHours,
      deliveryAddress: change.deliveryAddress ?? current.deliveryAddress,
      shipsFromAddress: change.shipsFromAddress ?? current.shipsFromAddress,
    })
    .returning();
  if (!version) throw new Error('trades: the terms insert returned no row');
  return version;
}

// ---------------------------------------------------------------------------
// W1 / W3: accept
// ---------------------------------------------------------------------------

export interface AcceptInput {
  userId: string;
  tradeId: string;
  /** The version the person is looking at. Accepting anything else would be agreeing to unseen terms. */
  termsVersionId: string;
  /** Needed only when the acceptor's own side has no address on the terms yet. */
  addressId?: string;
  /** The seller's proof, when the seller is the one accepting (W1). */
  proofFileIds?: string[];
}

export async function acceptProposal(deps: TradeDeps, input: AcceptInput): Promise<TradeView> {
  const before = await deps.db.transaction((tx) => loadTrade(tx, input.tradeId));
  const side = requireParty(before, input.userId);
  // The buyer gate, re-checked now: certification can be granted between send and acceptance.
  if (side === 'BUYER') {
    await refuseMerchantBuyer(deps, {
      buyerUserId: input.userId,
      actorId: input.userId,
      path: 'ACCEPT_AS_BUYER',
      tradeId: before.id,
    });
  }
  const standard = await deps.standards.pinned(requireCategory(before), requireVersion(before));

  const result = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (trade.acceptedTermsVersionId && trade.status !== 'AWAITING_ACCEPTANCE') {
      // Replay of an accept that already went through.
      if (trade.acceptedTermsVersionId === input.termsVersionId || trade.statusActorId === input.userId) {
        return viewTrade(tx, trade, input.userId);
      }
    }
    const current = await loadTerms(tx, trade.currentTermsVersionId);
    if (trade.status === 'AWAITING_ACCEPTANCE') {
      assertTheirTurn(current, input.userId);
      if (current.id !== input.termsVersionId) {
        throw new ApiError(
          409,
          'CONFLICT',
          'The terms changed',
          'The other party changed the terms while you were looking. Review the latest and try again.',
        );
      }
    }

    let accepted = current;
    const own = addressOf(current, side);
    if (!own) {
      // The side nobody has filled yet is the acceptor's: record it as the version they agreed to.
      const snapshot = await snapshotAddress(deps, tx, input.userId, input.addressId, side);
      accepted = await insertNextVersion(tx, current, {
        proposedByUserId: input.userId,
        proposedByRole: side,
        itemAmountMinor: current.itemAmountMinor,
        itemSpec: current.itemSpec as Record<string, unknown>,
        ...(side === 'BUYER' ? { deliveryAddress: snapshot } : { shipsFromAddress: snapshot }),
      });
    }

    if (side === 'SELLER' && input.proofFileIds?.length) {
      await attachProof(deps, tx, trade, input.userId, input.proofFileIds);
    }
    await assertSellerProof(deps, tx, trade.id, standard);

    const sellerId = trade.sellerUserId;
    if (!sellerId) throw new Error(`trades: trade ${trade.id} reached acceptance without a seller`);
    const seller = await readTradePrincipal(tx, sellerId);
    const snapshot = deps.snapshotFees(
      accepted.itemAmountMinor,
      sellerKindOf(seller.merchantCapabilityStatus),
    );

    await applyTransition(tx, {
      tradeId: trade.id,
      action: 'ACCEPT',
      to: 'PENDING_PAYMENT',
      actor: { type: side, id: input.userId },
      set: {
        ...feeSnapshotColumns(snapshot),
        acceptedTermsVersionId: accepted.id,
        currentTermsVersionId: accepted.id,
      },
    });
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'PROPOSAL_ACCEPTED',
      actorType: side,
      actorId: input.userId,
      termsVersionId: accepted.id,
      metadata: { feeScheduleVersion: snapshot.version },
    });
    return viewTrade(tx, await loadTrade(tx, trade.id), input.userId);
  });
  await grantProofToBuyer(deps, input.tradeId);
  return result;
}

// ---------------------------------------------------------------------------
// Invitations: claim and expiry
// ---------------------------------------------------------------------------

/**
 * Binds the person who claimed a trade invitation to the trade, moving it to AWAITING_ACCEPTANCE.
 *
 * Called by the claimed-invitation subscriber and by `POST /trades/:id/claim`, so the same rules
 * apply whichever arrives first and a repeat changes nothing. A claimer who would be the buyer is
 * checked for `canBuy` again here (path CLAIM_BUYER_INVITATION), and one with no usable saved
 * address gets 422 ADDRESS_REQUIRED: the client sends them to add one, then calls this again.
 */
export async function claimTradeInvitation(
  deps: TradeDeps,
  input: { userId: string; tradeId: string },
): Promise<TradeView> {
  const before = await deps.db.transaction((tx) => loadTrade(tx, input.tradeId));
  const counterpartyRole = otherRole(before.initiatorRole);
  if (before.status !== 'PENDING_COUNTERPARTY') {
    // Already claimed by this person (a replay) is fine; anything else is not theirs to see.
    const view = await deps.db.transaction(async (tx) => viewTrade(tx, before, input.userId));
    await grantProofToBuyer(deps, input.tradeId);
    return view;
  }
  if (counterpartyRole === 'BUYER') {
    await refuseMerchantBuyer(deps, {
      buyerUserId: input.userId,
      actorId: input.userId,
      path: 'CLAIM_BUYER_INVITATION',
      tradeId: before.id,
    });
  }

  const view = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (trade.status !== 'PENDING_COUNTERPARTY') return viewTrade(tx, trade, input.userId);
    if (!trade.counterpartyInvitationId) throw tradeNotFoundError();
    const [invitation] = await tx
      .select({ claimedByUserId: partyInvitations.claimedByUserId, status: partyInvitations.status })
      .from(partyInvitations)
      .where(eq(partyInvitations.id, trade.counterpartyInvitationId));
    if (invitation?.status !== 'CLAIMED' || invitation.claimedByUserId !== input.userId) {
      throw tradeNotFoundError();
    }
    // Both the usable-address rule and the 422 live in snapshotAddress; claiming only needs *a* usable one.
    await requireAnyUsableAddress(deps, tx, input.userId, counterpartyRole);

    await applyTransition(tx, {
      tradeId: trade.id,
      action: 'CLAIM_INVITATION',
      to: 'AWAITING_ACCEPTANCE',
      actor: { type: counterpartyRole, id: input.userId },
      set: counterpartyRole === 'BUYER' ? { buyerUserId: input.userId } : { sellerUserId: input.userId },
    });
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: counterpartyRole,
      actorId: input.userId,
      summary: 'Invitation claimed',
      metadata: { event: 'INVITATION_CLAIMED' },
    });
    return viewTrade(tx, await loadTrade(tx, trade.id), input.userId);
  });
  // Only on the success path, and after the commit: a claimer who is the buyer opens the proof now.
  await grantProofToBuyer(deps, input.tradeId);
  return view;
}

async function requireAnyUsableAddress(
  deps: Pick<TradeDeps, 'cities' | 'db'>,
  tx: Tx,
  userId: string,
  side: TradeInitiatorRole,
): Promise<void> {
  // identity's own answer to "does this user hold a live address in an active city".
  if (!(await hasUsableAddress({ db: tx, cities: deps.cities }, userId))) throw addressRequiredError(side);
}

/** M1 §8.5 step 7: the 14-day window ran out with nobody claiming. The trade expires with it. */
export async function expireTradeInvitation(
  deps: Pick<TradeDeps, 'db'>,
  input: { tradeId: string; invitationId: string },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (trade.status !== 'PENDING_COUNTERPARTY' || trade.counterpartyInvitationId !== input.invitationId)
      return;
    await applyTransition(tx, {
      tradeId: trade.id,
      action: 'EXPIRE',
      to: 'EXPIRED',
      actor: { type: 'SYSTEM' },
      reason: 'The invitation was not claimed within 14 days',
    });
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'DEADLINE_ELAPSED',
      actorType: 'SYSTEM',
      summary: 'The invitation expired unclaimed',
    });
  });
}
