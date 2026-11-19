// Evidence on a dispute (M3 D2) and the side-by-side comparison read model (T-081, screens Y1
// and Z6).
//
// The comparison is the interesting half. It is built entirely from reads the ports hand over, so
// it can be unit-tested without a database — which matters because its job is to be fair: the
// seller's pre-shipment proof and the buyer's unboxing photos are shown as two panels of the same
// shape, and a panel with nothing in it says so rather than being left out. A comparison that
// silently omits the empty side would read as "the other party submitted nothing" even when the
// truth is "this trade never had dispatch media".
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import type { Paginated } from '@komtru/shared-types';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { disputeEvidenceSubmitted, disputeEvidenceWindowClosed } from '../domain/events.js';
import {
  disputeNotFound,
  evidenceWindowClosed as evidenceWindowClosedError,
  notADisputeParty,
  wrongCursor,
} from '../domain/errors.js';
import { evidenceAcceptance, remaining, type Remaining } from '../domain/windows.js';
import { disputeEvidence } from '../infrastructure/postgres/schema/evidence.js';
import type { CustodyPhoto, DisputePorts, TimelineEntry, TradeMedia } from './ports.js';
import {
  DISPUTE_AUDIT,
  asParty,
  lockDispute,
  moveCase,
  writeDisputeAudit,
  type DisputeActor,
  type RequestActor,
} from './transition.js';
import { partyRole, toEvidenceView, type EvidenceView, type PartyRole } from './views.js';

export interface SubmitEvidenceInput {
  disputeId: string;
  userId: string;
  fileRefId?: string | null;
  note?: string | null;
  actor: RequestActor;
}

/**
 * Add something to the record. Allowed while the case is collecting evidence, and also during
 * mediation — a party arguing their case to the other party needs the same photos a reviewer
 * would see, and making them wait for mediation to fail before they can show anything is how a
 * mediation window gets wasted.
 */
export async function submitEvidence(
  ports: DisputePorts,
  tx: Tx,
  input: SubmitEvidenceInput,
): Promise<EvidenceView> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();
  const role = partyRole(row, input.userId);
  if (role === null) throw notADisputeParty();

  const now = ports.now();
  const open = row.status === 'MEDIATION' || row.status === 'OPEN_EVIDENCE_COLLECTION';
  if (!open) throw evidenceWindowClosedError();

  // M3 D2: during mediation the evidence deadline has not begun to bite, so nothing is late yet.
  const acceptance =
    row.status === 'MEDIATION'
      ? 'IN_WINDOW'
      : evidenceAcceptance({
          deadline: row.evidenceDeadlineAt,
          now,
          collectionReopened: row.evidenceReopenedAt !== null,
        });
  if (acceptance === 'REFUSED') throw evidenceWindowClosedError();

  const [evidence] = await tx
    .insert(disputeEvidence)
    .values({
      disputeId: row.id,
      submittedByUserId: input.userId,
      fileRefId: input.fileRefId ?? null,
      note: input.note?.trim() || null,
      submittedAfterDeadline: acceptance === 'LATE_REOPENED',
    })
    .returning();
  if (!evidence) throw new Error('disputes: the evidence insert returned no row');

  // M20: the file is DISPUTE_EVIDENCE / PRIVATE_CASE, so it is readable only by the people granted
  // it. Both parties and the assigned reviewer, if there is one yet.
  if (evidence.fileRefId) {
    const userIds = [row.buyerUserId, row.sellerUserId, row.assignedReviewerId].filter(
      (id): id is string => id !== null,
    );
    await ports.grantEvidenceAccess(tx, { fileRefId: evidence.fileRefId, userIds });
  }

  await writeDisputeAudit(tx, asParty(input.actor, row), DISPUTE_AUDIT.EVIDENCE_SUBMITTED, {
    disputeId: row.id,
    evidenceId: evidence.id,
    late: evidence.submittedAfterDeadline,
  });

  await publish(tx, disputeEvidenceSubmitted, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      evidenceId: evidence.id,
      submittedByUserId: input.userId,
      submittedAfterDeadline: evidence.submittedAfterDeadline,
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  return toEvidenceView(evidence);
}

/** The evidence window has run out (or a reviewer closed it early): the case goes to review. */
export async function closeEvidenceWindow(
  ports: DisputePorts,
  tx: Tx,
  input: { disputeId: string; actor: DisputeActor },
): Promise<void> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();

  const now = ports.now();
  await moveCase(tx, row, {
    action: 'CLOSE_EVIDENCE',
    to: 'UNDER_REVIEW',
    actor: input.actor,
    reason: 'The evidence window closed',
  });

  await publish(tx, disputeEvidenceWindowClosed, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      closedAt: now.toISOString(),
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });
}

/**
 * M3 D2's reopen. A reviewer, and only a reviewer, lets late evidence in — logged, never silent,
 * and recorded on the case so every later submission is flagged as having arrived after the
 * window.
 */
export async function reopenEvidenceWindow(
  ports: DisputePorts,
  tx: Tx,
  input: { disputeId: string; reason: string; actor: RequestActor },
): Promise<void> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();

  const acting = asParty(input.actor, row);
  await moveCase(tx, row, {
    action: 'REOPEN_EVIDENCE',
    to: 'OPEN_EVIDENCE_COLLECTION',
    actor: acting,
    reason: input.reason,
    set: { evidenceReopenedAt: ports.now() },
  });

  await writeDisputeAudit(tx, acting, DISPUTE_AUDIT.EVIDENCE_REOPENED, {
    disputeId: row.id,
    reason: input.reason,
  });
}

/** One party's side of the comparison. Always present, even when it holds nothing. */
export interface EvidencePanel {
  role: PartyRole;
  userId: string;
  /** Media already on the trade: the seller's dispatch proof, the buyer's inspection photos. */
  fromTrade: TradeMedia[];
  /** What this party added to the dispute itself. */
  fromDispute: EvidenceView[];
}

export interface EvidenceComparison {
  disputeId: string;
  tradeId: string;
  seller: EvidencePanel;
  buyer: EvidencePanel;
  /** Empty unless the trade went through a Park hub. */
  custody: CustodyPhoto[];
  timeline: TimelineEntry[];
  /** Y1's strip: "Auto-escalates to TrustOps in 31h if not mutually resolved". */
  mediation: { deadlineAt: Date; remaining: Remaining } | null;
}

/**
 * T-081. Assembled from the ports, so it is testable without a database and the same shape
 * whichever party is asking — the comparison is deliberately NOT personalised. Both sides see the
 * same two panels; a view that showed you more of your own evidence than the other party's would
 * not be a comparison.
 */
export async function evidenceComparison(
  ports: DisputePorts,
  tx: Tx,
  input: { disputeId: string; userId: string },
): Promise<EvidenceComparison> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();
  if (partyRole(row, input.userId) === null) throw notADisputeParty();

  const [media, custody, timeline, submitted] = await Promise.all([
    ports.tradeMedia(tx, row.tradeId),
    ports.custodyPhotos(tx, row.tradeId),
    ports.shipmentTimeline(tx, row.tradeId),
    tx
      .select()
      .from(disputeEvidence)
      .where(eq(disputeEvidence.disputeId, row.id))
      .orderBy(asc(disputeEvidence.submittedAt), asc(disputeEvidence.id)),
  ]);

  const panel = (role: PartyRole, userId: string, events: TradeMedia['event'][]): EvidencePanel => ({
    role,
    userId,
    fromTrade: media.filter((item) => item.uploadedByUserId === userId && events.includes(item.event)),
    fromDispute: submitted.filter((item) => item.submittedByUserId === userId).map(toEvidenceView),
  });

  const now = ports.now();
  return {
    disputeId: row.id,
    tradeId: row.tradeId,
    // "Seller's pre-shipment proof" is dispatch media; "buyer's unboxing photos" are the
    // inspection and issue media. Delivery media belongs to whoever recorded it, and shows on
    // that person's panel.
    seller: panel('SELLER', row.sellerUserId, ['DISPATCH', 'DELIVERY']),
    buyer: panel('BUYER', row.buyerUserId, ['INSPECTION', 'ISSUE', 'DELIVERY']),
    custody,
    timeline,
    mediation:
      row.status === 'MEDIATION'
        ? { deadlineAt: row.mediationDeadlineAt, remaining: remaining(row.mediationDeadlineAt, now) }
        : null,
  };
}

const evidenceCursor = (row: { submittedAt: Date; id: string }): CursorKey => ({
  t: row.submittedAt.toISOString(),
  id: row.id,
});

const readCursor = (cursor: CursorKey | undefined): { t: string; id: string } | undefined => {
  if (cursor === undefined) return undefined;
  const { t, id } = cursor;
  if (Object.keys(cursor).sort().join(',') !== 'id,t' || typeof t !== 'string' || typeof id !== 'string') {
    throw wrongCursor();
  }
  return { t, id };
};

/** The case's evidence, oldest first, paginated from the first line. */
export async function listDisputeEvidence(
  tx: Tx,
  input: { disputeId: string; userId: string; limit: number; cursor?: CursorKey | undefined },
): Promise<Paginated<EvidenceView>> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();
  if (partyRole(row, input.userId) === null) throw notADisputeParty();

  const after = readCursor(input.cursor);
  const rows = await tx
    .select()
    .from(disputeEvidence)
    .where(
      and(
        eq(disputeEvidence.disputeId, row.id),
        after
          ? or(
              gt(disputeEvidence.submittedAt, new Date(after.t)),
              and(
                eq(disputeEvidence.submittedAt, new Date(after.t)),
                gt(sql`${disputeEvidence.id}::text`, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(disputeEvidence.submittedAt), asc(disputeEvidence.id))
    .limit(input.limit + 1);

  return cursorPage(rows.map(toEvidenceView), input.limit, evidenceCursor);
}
