// The ship step (T-064): the dispatch guard (X1), the options the server computes for the seller
// (X2, design §7.8), and the self-arranged branch. Company shipping (T-087) and Park shipping
// (T-093) are completed in their own tickets; both go through `assertDispatchOpen` and the ports in
// fulfilmentPorts.ts, so neither has to re-derive when shipping is allowed or what is offered.
import { and, eq, ne } from 'drizzle-orm';
import { isUniqueViolation } from '../../../db/errors.js';
import { ApiError } from '../../../platform/errors.js';
import type { Tx } from '../../../platform/events/publish.js';
import {
  buildShipOptions,
  dispatchGuard,
  type CityCoverage,
  type SelfArrangedShipmentInput,
  type ShipOption,
} from '../domain/fulfilment.js';
import { selfArrangedShipments, tradeDeadlines } from '../infrastructure/postgres/schema/fulfilment.js';
import { tradeEvidenceMedia, tradeProofMedia } from '../infrastructure/postgres/schema/proof.js';
import { applyTransition } from '../infrastructure/postgres/transitions.js';
import { hasApprovedCancellation } from './cancellation.service.js';
import type { FulfilmentDeps } from './fulfilmentPorts.js';
import {
  loadTerms,
  loadTrade,
  recordActivity,
  requireParty,
  viewTrade,
  type AddressSnapshot,
  type TradeRow,
} from './trade.service.js';

const forbiddenNotSeller = (): ApiError =>
  new ApiError(403, 'FORBIDDEN', 'Only the seller can ship this trade');

/** A stranger and a missing trade look the same (requireParty); a buyer is told this is not theirs to do. */
export function requireSeller(trade: TradeRow, userId: string): void {
  if (requireParty(trade, userId) !== 'SELLER') throw forbiddenNotSeller();
}

/**
 * X1, in one place for every shipping endpoint including T-087's and T-093's. Before FUNDED the
 * answer is the lock the screen explains ("Dispatch locked, awaiting escrow"); afterwards it is the
 * ordinary invalid transition. A trade whose delivery deadline has elapsed has a refund in flight
 * (DE4), and shipping into it would leave a parcel moving against escrow that is being returned. So
 * does an approved cancellation (T-066).
 */
export async function assertDispatchOpen(tx: Tx, trade: TradeRow): Promise<void> {
  const guard = dispatchGuard(trade.status);
  if (!guard.open) {
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      guard.reason === 'DISPATCH_LOCKED'
        ? 'Dispatch is locked until the trade is funded'
        : 'This trade cannot be shipped',
      `Shipping is only possible while a trade is FUNDED; this one is ${trade.status}.`,
      undefined,
      { reason: guard.reason, status: trade.status },
    );
  }
  const [elapsed] = await tx
    .select({ id: tradeDeadlines.id })
    .from(tradeDeadlines)
    .where(
      and(
        eq(tradeDeadlines.tradeId, trade.id),
        eq(tradeDeadlines.kind, 'DELIVERY'),
        eq(tradeDeadlines.status, 'ELAPSED'),
      ),
    )
    .limit(1);
  if (elapsed) {
    throw new ApiError(
      409,
      'CONFLICT',
      'The delivery deadline has passed',
      'This trade missed its delivery deadline and the buyer is being refunded, so it can no longer be shipped.',
      undefined,
      { reason: 'DELIVERY_OVERDUE' },
    );
  }
  // T-066: an approved cancellation (CR2) or a seller's own (SC1) has asked for the escrow back.
  if (await hasApprovedCancellation(tx, trade.id)) {
    throw new ApiError(
      409,
      'CONFLICT',
      'This trade has been cancelled',
      'A cancellation was agreed and the buyer is being refunded, so it can no longer be shipped.',
      undefined,
      { reason: 'CANCELLATION_APPROVED' },
    );
  }
}

const cityOf = (snapshot: unknown): string | null => {
  const id = (snapshot as Partial<AddressSnapshot> | null)?.city_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

// ---------------------------------------------------------------------------
// X2: the options
// ---------------------------------------------------------------------------

export type ShipOptionsView = {
  tradeId: string;
  tradeCode: string;
  options: ShipOption[];
};

/**
 * What the seller may choose, computed here so the client never decides availability. Park is
 * listed first whatever the answer, with the reason when it is not available (design §7.8): both
 * the delivery city and the ships-from city of the accepted terms must be serviceable.
 */
export async function getShipOptions(
  deps: Pick<FulfilmentDeps, 'db' | 'cities' | 'logistics' | 'park'>,
  input: { userId: string; tradeId: string },
): Promise<ShipOptionsView> {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId);
    requireSeller(trade, input.userId);
    await assertDispatchOpen(tx, trade);

    const terms = await loadTerms(tx, trade.acceptedTermsVersionId ?? trade.currentTermsVersionId);
    const deliveryCityId = cityOf(terms.deliveryAddress);
    const shipsFromCityId = cityOf(terms.shipsFromAddress);
    const cityIds = [...new Set([deliveryCityId, shipsFromCityId].filter((id): id is string => id !== null))];

    const [names, serviceable, companies] = await Promise.all([
      cityIds.length ? deps.cities(tx, cityIds) : Promise.resolve([]),
      cityIds.length ? deps.park.serviceableCityIds(tx, cityIds) : Promise.resolve(new Set<string>()),
      deps.logistics.enabledCompanies(tx),
    ]);
    const coverage = (id: string | null): CityCoverage | null =>
      id === null
        ? null
        : {
            id,
            name: names.find((city) => city.id === id)?.name ?? 'this city',
            serviceable: serviceable.has(id),
          };

    return {
      tradeId: trade.id,
      tradeCode: trade.tradeCode,
      options: buildShipOptions({
        companies,
        coverage: { delivery: coverage(deliveryCityId), shipsFrom: coverage(shipsFromCityId) },
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// X2: arrange my own shipping
// ---------------------------------------------------------------------------

type SelfArrangedRow = typeof selfArrangedShipments.$inferSelect;

const shipmentView = (row: SelfArrangedRow) => ({
  method: 'SELF_ARRANGED' as const,
  waybillNumber: row.waybillNumber,
  receiptFileId: row.receiptFileId,
  driverPhone: row.driverPhone,
  vehiclePlate: row.vehiclePlate,
  shippedAt: row.createdAt.toISOString(),
});

const receiptRejected = (): ApiError =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'The waybill receipt photo cannot be used',
    'Attach your own finished photo upload of the waybill receipt, not used anywhere else.',
    [{ path: 'receiptFileId', message: 'Not a usable photo upload' }],
  );

/** The receipt is the seller's own READY image, and not already evidence on any trade. */
async function checkReceipt(
  deps: Pick<FulfilmentDeps, 'proofFiles'>,
  tx: Tx,
  trade: TradeRow,
  userId: string,
  fileId: string,
): Promise<void> {
  const [file] = await deps.proofFiles(tx, [fileId]);
  if (
    !file ||
    file.uploaderUserId !== userId ||
    file.visibility !== 'PRIVATE_CASE' ||
    !file.contentType.startsWith('image/')
  ) {
    throw receiptRejected();
  }
  const [asProof] = await tx
    .select({ id: tradeProofMedia.id })
    .from(tradeProofMedia)
    .where(eq(tradeProofMedia.fileId, fileId))
    .limit(1);
  // Evidence on any trade is shared with that trade's other party; as a receipt it would be shown to a stranger.
  const [asEvidence] = await tx
    .select({ id: tradeEvidenceMedia.id })
    .from(tradeEvidenceMedia)
    .where(eq(tradeEvidenceMedia.fileId, fileId))
    .limit(1);
  const [asReceipt] = await tx
    .select({ id: selfArrangedShipments.id })
    .from(selfArrangedShipments)
    .where(and(eq(selfArrangedShipments.receiptFileId, fileId), ne(selfArrangedShipments.tradeId, trade.id)))
    .limit(1);
  if (asProof || asEvidence || asReceipt) throw receiptRejected();
}

/**
 * X2: the seller shipped it themselves. The four pieces of evidence arrive validated by the route's
 * schema; the receipt photo is checked here because it needs the file record. Custody begins
 * (`BEGIN_CUSTODY`, FUNDED to SHIPPED) in the same transaction that stores the evidence, so there
 * is no SHIPPED trade without a waybill behind it. A replay by the same seller with the same waybill
 * returns the trade as it stands.
 */
export async function shipSelfArranged(
  deps: Pick<FulfilmentDeps, 'db' | 'proofFiles'>,
  input: { userId: string; tradeId: string; shipment: SelfArrangedShipmentInput },
) {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    requireSeller(trade, input.userId);

    const [existing] = await tx
      .select()
      .from(selfArrangedShipments)
      .where(eq(selfArrangedShipments.tradeId, trade.id));
    if (
      existing &&
      trade.status !== 'FUNDED' &&
      existing.shippedByUserId === input.userId &&
      existing.waybillNumber === input.shipment.waybillNumber
    ) {
      return { ...(await viewTrade(tx, trade, input.userId)), shipment: shipmentView(existing) };
    }

    await assertDispatchOpen(tx, trade);
    await checkReceipt(deps, tx, trade, input.userId, input.shipment.receiptFileId);

    // The read check above gives the good error; the unique index is what two concurrent shipments hit.
    const [row] = await tx
      .insert(selfArrangedShipments)
      .values({
        tradeId: trade.id,
        waybillNumber: input.shipment.waybillNumber,
        receiptFileId: input.shipment.receiptFileId,
        driverPhone: input.shipment.driverPhone,
        vehiclePlate: input.shipment.vehiclePlate,
        shippedByUserId: input.userId,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'self_arranged_receipt_file')) throw receiptRejected();
        throw error;
      });
    if (!row) throw new Error('trades: the shipment insert returned no row');

    await applyTransition(tx, {
      tradeId: trade.id,
      action: 'BEGIN_CUSTODY',
      to: 'SHIPPED',
      actor: { type: 'SELLER', id: input.userId },
      context: { method: 'SELF_ARRANGED', waybillNumber: row.waybillNumber },
      // The company branch (T-087) sets AWAITING_SHIPMENT while it waits; whichever way custody
      // begins, that wait is over.
      set: { fulfilmentSubstate: null },
    });
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: 'SELLER',
      actorId: input.userId,
      summary: `Shipped with own arrangement, waybill ${row.waybillNumber}`,
      metadata: { event: 'SHIPPED', method: 'SELF_ARRANGED' },
    });
    return {
      ...(await viewTrade(tx, await loadTrade(tx, trade.id), input.userId)),
      shipment: shipmentView(row),
    };
  });
}
