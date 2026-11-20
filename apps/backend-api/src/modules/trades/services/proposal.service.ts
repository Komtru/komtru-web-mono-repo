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
import { isDeepStrictEqual } from 'node:util';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { ApiError } from '../../../platform/errors.js';
import type { Tx } from '../../../platform/events/publish.js';
import {
  cancelInvitation,
  createInvitation,
  hasUsableAddress,
  lookupKeyForEmail,
  lookupKeyForPhone,
  lookupKeyForUsername,
  lockUserForTrade,
  lookupParty,
  partyInvitations,
  users,
  type LookupKey,
} from '../../identity/index.js';
import { validateItemSpec } from '../../config/index.js';
import { canActAsBuyer, type TradeInitiatorRole } from '../domain/eligibility.js';
import {
  addressRequiredError,
  invalidTransitionError,
  itemSpecInvalidError,
  merchantCannotBuyError,
  proofMediaRequiredError,
  selfTradeError,
  tradeNotFoundError,
} from '../domain/errors.js';
import { feeSnapshotColumns } from '../domain/feeSnapshot.js';
import { checkProofMedia, otherRole, type ProofRequirement } from '../domain/proposal.js';
import type { BuyerPath } from '../domain/eligibility.js';
import { tradeEvidenceMedia, tradeProofMedia } from '../infrastructure/postgres/schema/proof.js';
import { tradeTermsVersions } from '../infrastructure/postgres/schema/terms.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { readTradePrincipal, recordEligibilityBlock } from '../infrastructure/postgres/principals.js';
import { lockSellerAllowance, sellingTodayMinor } from '../infrastructure/postgres/sellLimit.js';
import { assertWithinSellLimit, remainingToday, sellLimitFor } from '../domain/sellLimit.js';
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
  revokeProofFromBuyer,
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

/**
 * The selling limit (owner ruling 2026-11-20), checked wherever the seller commits to terms:
 * creating a trade as seller, sending it, countering, and accepting. Runs inside the caller's
 * transaction and holds a per-seller lock to its end, so two commitments at once are decided one
 * after the other. A certified merchant passes without a read.
 */
async function assertSellerWithinLimit(
  deps: Pick<TradeDeps, 'sellLimit'>,
  tx: Tx,
  input: { sellerUserId: string; amountMinor: Kobo; tradeId?: string },
): Promise<void> {
  const seller = await readTradePrincipal(tx, input.sellerUserId);
  const limit = sellLimitFor(seller.merchantCapabilityStatus, deps.sellLimit());
  if (limit === null) return;
  // The per-trade cap needs no total, so it is answered before taking the lock.
  assertWithinSellLimit(limit, input.amountMinor, 0n);
  await lockSellerAllowance(tx, input.sellerUserId);
  const soldToday = await sellingTodayMinor(tx, {
    sellerUserId: input.sellerUserId,
    at: new Date(),
    ...(input.tradeId ? { excludeTradeId: input.tradeId } : {}),
  });
  assertWithinSellLimit(limit, input.amountMinor, soldToday);
}

const proofRequirement = (standard: TradeStandard): ProofRequirement => standard.proofMedia;

/**
 * The seller's own proof, checked and not yet written: finished, private-to-the-case uploads that
 * the seller made and that are not already doing a job somewhere else.
 *
 * "Somewhere else" is the files module's linkage as far as it goes: it records grants and nothing
 * else about what a file is for. So a file qualifies when it is not attached to another trade
 * (this module's own table) and holds no live grant to anybody (another case's evidence, another
 * trade's buyer). A file already on this trade is always fine, which keeps a re-attach idempotent.
 * The trade carries at most MAX_PROOF_FILES in total, across every send, counter and accept.
 *
 * Returns the files that are new to the trade.
 */
async function checkProofFiles(
  deps: Pick<TradeDeps, 'proofFiles'>,
  tx: Tx,
  trade: { id: string },
  sellerUserId: string,
  fileIds: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(fileIds)];
  if (unique.length === 0) return [];
  const attached = new Set(await proofFileIds(tx, trade.id));
  const fresh = unique.filter((id) => !attached.has(id));
  if (attached.size + fresh.length > MAX_PROOF_FILES) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      `A trade can carry at most ${MAX_PROOF_FILES} proof files`,
      undefined,
      [{ path: 'proofFileIds', message: `${attached.size} already attached` }],
    );
  }
  const found = await deps.proofFiles(tx, unique);
  const elsewhere = fresh.length
    ? new Set(
        (
          await tx
            .select({ fileId: tradeProofMedia.fileId })
            .from(tradeProofMedia)
            .where(and(inArray(tradeProofMedia.fileId, fresh), ne(tradeProofMedia.tradeId, trade.id)))
        ).map((row) => row.fileId),
      )
    : new Set<string>();
  // A file already added as evidence on any trade is shared with that trade's other party: never seller proof.
  const asEvidence = fresh.length
    ? new Set(
        (
          await tx
            .select({ fileId: tradeEvidenceMedia.fileId })
            .from(tradeEvidenceMedia)
            .where(inArray(tradeEvidenceMedia.fileId, fresh))
        ).map((row) => row.fileId),
      )
    : new Set<string>();
  const usable = new Set(
    found
      .filter(
        (f) =>
          f.uploaderUserId === sellerUserId &&
          f.visibility === 'PRIVATE_CASE' &&
          (attached.has(f.id) ||
            (!elsewhere.has(f.id) && !asEvidence.has(f.id) && f.grantedUserIds.length === 0)),
      )
      .map((f) => f.id),
  );
  const rejected = unique.filter((id) => !usable.has(id));
  if (rejected.length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Some proof files cannot be used',
      'Proof must be your own finished uploads, not used anywhere else.',
      rejected.map((id) => ({ path: 'proofFileIds', message: `${id} is not an usable upload` })),
    );
  }
  return fresh;
}

async function attachProof(
  deps: Pick<TradeDeps, 'proofFiles'>,
  tx: Tx,
  trade: { id: string },
  sellerUserId: string,
  fileIds: readonly string[],
): Promise<void> {
  const fresh = await checkProofFiles(deps, tx, trade, sellerUserId, fileIds);
  if (fresh.length === 0) return;
  await tx
    .insert(tradeProofMedia)
    .values(fresh.map((fileId) => ({ tradeId: trade.id, fileId, attachedByUserId: sellerUserId })))
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
  const { principal, soldToday } = await deps.db.transaction(async (tx) => ({
    principal: await readTradePrincipal(tx, input.userId),
    soldToday: await sellingTodayMinor(tx, { sellerUserId: input.userId, at: new Date() }),
  }));
  const sellLimit = sellLimitFor(principal.merchantCapabilityStatus, deps.sellLimit());
  const allowedRoles: TradeInitiatorRole[] = canActAsBuyer(principal) ? ['BUYER', 'SELLER'] : ['SELLER'];
  const amount =
    input.itemAmountMinor !== undefined && input.itemAmountMinor > 0n ? input.itemAmountMinor : null;
  const kinds =
    input.role === 'SELLER' ? [sellerKindOf(principal.merchantCapabilityStatus)] : ['CASUAL', 'MERCHANT'];
  return {
    allowedRoles,
    // What this person may still sell, for the Start Trade warnings; null when they have no limit.
    sellLimit:
      sellLimit === null
        ? null
        : {
            // Strings, as every amount in a response is: JSON has no bigint.
            perTradeMinor: sellLimit.perTradeMinor.toString(),
            perDayMinor: sellLimit.perDayMinor.toString(),
            remainingTodayMinor: (remainingToday(sellLimit, soldToday) ?? 0n).toString(),
          },
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
    // First: see lockUserForTrade. A closing account must not gain a trade behind the closure's back.
    await lockUserForTrade(tx, input.userId);
    if (input.role === 'SELLER')
      await assertSellerWithinLimit(deps, tx, {
        sellerUserId: input.userId,
        amountMinor: input.itemAmountMinor,
      });
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

type Found = { kind: 'USER'; userId: string } | { kind: 'INVITE' };
type Resolved = { kind: 'USER'; userId: string } | { kind: 'INVITED'; invitationId: string };

/** Who the sender named, without creating anything: an existing person, or somebody to invite. */
async function findCounterparty(deps: TradeDeps, input: SendInput): Promise<Found> {
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
  return { kind: 'INVITE' };
}

/** Writes the invitation. Called last, once everything that can refuse the send has been checked. */
async function inviteCounterparty(
  deps: TradeDeps,
  input: SendInput,
  trade: TradeRow,
  counterpartyRole: TradeInitiatorRole,
): Promise<Resolved> {
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

/**
 * Everything about the sender's side that can refuse a send, read-only: the address is still
 * usable, and a seller's proof (what is attached plus what this call adds) meets the standard.
 * Run before an invitation exists, so a refusal leaves nothing behind. The send repeats these
 * checks under the row lock, which is the one that counts.
 */
async function assertSendable(
  deps: TradeDeps,
  tx: Tx,
  trade: TradeRow,
  input: SendInput,
  standard: TradeStandard,
): Promise<void> {
  const terms = await loadTerms(tx, trade.currentTermsVersionId);
  await snapshotAddress(
    deps,
    tx,
    input.userId,
    addressOf(terms, trade.initiatorRole)?.source_address_id,
    trade.initiatorRole,
  );
  if (trade.initiatorRole !== 'SELLER') return;
  const fresh = await checkProofFiles(deps, tx, trade, input.userId, input.proofFileIds ?? []);
  const files = await deps.proofFiles(tx, [...(await proofFileIds(tx, trade.id)), ...fresh]);
  const check = checkProofMedia(proofRequirement(standard), files);
  if (!check.ok) throw proofMediaRequiredError(check);
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
  const target = await findCounterparty(deps, input);
  if (target.kind === 'USER') {
    if (target.userId === input.userId) throw selfTradeError();
    // Rejected before send: a certified merchant cannot be named as the buyer.
    if (counterpartyRole === 'BUYER') {
      await refuseMerchantBuyer(deps, {
        buyerUserId: target.userId,
        actorId: input.userId,
        path: 'NAMED_AS_BUYER',
        tradeId: draft.id,
      });
    }
  }

  const standard = await deps.standards.pinned(requireCategory(draft), requireVersion(draft));
  await deps.db.transaction((tx) => assertSendable(deps, tx, draft, input, standard));

  // Only now, with nothing left that can refuse the send, is the invitation written.
  const resolved: Resolved =
    target.kind === 'USER' ? target : await inviteCounterparty(deps, input, draft, counterpartyRole);

  let result: TradeView;
  try {
    result = await sendInTransaction(deps, input, standard, resolved, counterpartyRole);
  } catch (error) {
    // The send failed after the invitation was written: withdraw it rather than leave a live
    // invitation pointing at a trade that never went out.
    if (resolved.kind === 'INVITED') await cancelInvitation(deps.db, resolved.invitationId);
    throw error;
  }

  if (resolved.kind === 'INVITED')
    result = await settleEarlyClaim(deps, input, resolved.invitationId, result);
  await grantProofToBuyer(deps, input.tradeId);
  return result;
}

/**
 * The invitee may have claimed between the invitation being written and the send committing; the
 * claimed-invitation subscriber then found a DRAFT and did nothing. Run the claim now so the trade
 * does not stall in PENDING_COUNTERPARTY. A refusal (no usable address yet, a merchant claiming a
 * buyer invitation) is the claimer's to resolve through POST /trades/:id/claim and does not undo
 * the send.
 */
async function settleEarlyClaim(
  deps: TradeDeps,
  input: SendInput,
  invitationId: string,
  sent: TradeView,
): Promise<TradeView> {
  const [invitation] = await deps.db
    .select({ status: partyInvitations.status, claimedByUserId: partyInvitations.claimedByUserId })
    .from(partyInvitations)
    .where(eq(partyInvitations.id, invitationId));
  if (invitation?.status !== 'CLAIMED' || !invitation.claimedByUserId) return sent;
  try {
    await claimTradeInvitation(deps, { userId: invitation.claimedByUserId, tradeId: input.tradeId });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return sent;
  }
  return deps.db.transaction(async (tx) => viewTrade(tx, await loadTrade(tx, input.tradeId), input.userId));
}

async function sendInTransaction(
  deps: TradeDeps,
  input: SendInput,
  standard: TradeStandard,
  resolved: Resolved,
  counterpartyRole: TradeInitiatorRole,
): Promise<TradeView> {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (trade.status !== 'DRAFT') return viewTrade(tx, trade, input.userId);
    const terms = await loadTerms(tx, trade.currentTermsVersionId);

    // The initiator's own side must still be usable: an address archived since the draft was made
    // cannot be shipped to, and the client sends the user to add one.
    const own = addressOf(terms, trade.initiatorRole);
    await snapshotAddress(deps, tx, input.userId, own?.source_address_id, trade.initiatorRole);

    if (trade.initiatorRole === 'SELLER') {
      await assertSellerWithinLimit(deps, tx, {
        sellerUserId: input.userId,
        amountMinor: terms.itemAmountMinor,
        tradeId: trade.id,
      });
      if (input.proofFileIds?.length) await attachProof(deps, tx, trade, input.userId, input.proofFileIds);
      await assertSellerProof(deps, tx, trade.id, standard);
    }

    if (resolved.kind === 'USER') await lockUserForTrade(tx, resolved.userId);
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

const staleTradeError = (): ApiError =>
  new ApiError(
    409,
    'CONFLICT',
    'The trade changed',
    'The trade moved on while you were looking. Review the latest terms and try again.',
  );

export async function counterPropose(deps: TradeDeps, input: CounterInput): Promise<TradeView> {
  const before = await deps.db.transaction((tx) => loadTrade(tx, input.tradeId));
  const side = requireParty(before, input.userId);
  // The buyer gate, re-checked: a buyer countering is taking the buyer side again, and
  // certification can be granted after the proposal was sent. A retry on a trade that has moved on
  // is answered below, not refused here.
  if (side === 'BUYER' && before.status === 'AWAITING_ACCEPTANCE') {
    await refuseMerchantBuyer(deps, {
      buyerUserId: input.userId,
      actorId: input.userId,
      path: 'ACCEPT_AS_BUYER',
      tradeId: before.id,
    });
  }

  const result = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    const role = requireParty(trade, input.userId);
    const current = await loadTerms(tx, trade.currentTermsVersionId);

    // Idempotent replay: these terms are already this person's own proposal, they say what the
    // retry says, and the trade has moved past the revision the retry carries, so the first attempt
    // got through. A different body at a stale revision is a lost race, not a retry.
    if (
      trade.status === 'AWAITING_ACCEPTANCE' &&
      current.proposedByUserId === input.userId &&
      trade.statusRevision > input.expectedRevision &&
      (input.itemAmountMinor === undefined || input.itemAmountMinor === current.itemAmountMinor) &&
      (input.itemSpec === undefined || isDeepStrictEqual(input.itemSpec, current.itemSpec)) &&
      (input.addressId === undefined || input.addressId === addressOf(current, role)?.source_address_id)
    ) {
      return viewTrade(tx, trade, input.userId);
    }
    // The state guard runs before anything that looks at the body, so the wrong state is always
    // the same answer whatever was sent with it.
    if (trade.statusRevision !== input.expectedRevision) throw staleTradeError();
    if (trade.status !== 'AWAITING_ACCEPTANCE') {
      throw invalidTransitionError('COUNTER_PROPOSE', trade.status, 'AWAITING_ACCEPTANCE');
    }
    assertTheirTurn(current, input.userId);

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

    // A counter that changes nothing is not a counter: it would burn a version and hand the turn
    // back with the same terms.
    const attached = new Set(await proofFileIds(tx, trade.id));
    const newProof = role === 'SELLER' && (input.proofFileIds ?? []).some((id) => !attached.has(id));
    if (
      amount === current.itemAmountMinor &&
      isDeepStrictEqual(spec, current.itemSpec) &&
      own.source_address_id === ownBefore?.source_address_id &&
      !newProof
    ) {
      throw new ApiError(
        422,
        'VALIDATION_FAILED',
        'Nothing was changed',
        'Change the price, the item details, your address or the proof.',
        [{ path: 'itemAmountMinor', message: 'Change at least one term' }],
      );
    }

    if (role === 'SELLER')
      await assertSellerWithinLimit(deps, tx, {
        sellerUserId: input.userId,
        amountMinor: amount,
        tradeId: trade.id,
      });

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

/**
 * The state guard for accept, ahead of every check that looks at addresses, proof or eligibility, so
 * a trade in the wrong state is always 409 INVALID_TRANSITION. Returns 'REPLAY' for the one case
 * that is a success: the acceptor asking again after their accept went through.
 */
function acceptGuard(trade: TradeRow, userId: string): 'OPEN' | 'REPLAY' {
  if (trade.status === 'AWAITING_ACCEPTANCE') return 'OPEN';
  if (
    trade.status === 'PENDING_PAYMENT' &&
    trade.statusAction === 'ACCEPT' &&
    trade.statusActorId === userId
  ) {
    return 'REPLAY';
  }
  throw invalidTransitionError('ACCEPT', trade.status, 'PENDING_PAYMENT');
}

export async function acceptProposal(deps: TradeDeps, input: AcceptInput): Promise<TradeView> {
  const before = await deps.db.transaction((tx) => loadTrade(tx, input.tradeId));
  const side = requireParty(before, input.userId);
  if (acceptGuard(before, input.userId) === 'REPLAY') {
    const view = await deps.db.transaction((tx) => viewTrade(tx, before, input.userId));
    await grantProofToBuyer(deps, input.tradeId);
    return view;
  }
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
    // Re-decided under the lock: a concurrent accept or counter may have moved the trade since.
    if (acceptGuard(trade, input.userId) === 'REPLAY') return viewTrade(tx, trade, input.userId);
    const current = await loadTerms(tx, trade.currentTermsVersionId);
    assertTheirTurn(current, input.userId);
    if (current.id !== input.termsVersionId) {
      throw new ApiError(
        409,
        'CONFLICT',
        'The terms changed',
        'The other party changed the terms while you were looking. Review the latest and try again.',
      );
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

    if (side === 'SELLER')
      await assertSellerWithinLimit(deps, tx, {
        sellerUserId: input.userId,
        amountMinor: accepted.itemAmountMinor,
        tradeId: trade.id,
      });
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
    await lockUserForTrade(tx, input.userId);

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
  deps: Pick<TradeDeps, 'db' | 'revokeProofAccess'>,
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
  // No buyer is bound while an invitation is open, so this is normally a no-op; it keeps the rule
  // in one place for every way a trade ends unfunded.
  await revokeProofFromBuyer(deps, input.tradeId);
}
