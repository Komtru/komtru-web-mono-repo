// The read side (T-081): what a party sees on Customer-8 / CWT-S15 / H1 / H2, and what a reviewer
// sees in the queue. Reads take `Pick<Db, 'select'>`, so nothing here can write.
//
// Every list is cursor-paginated from the first line, and every cursor is bound to the list it was
// made for: a cursor from the party list handed to the reviewer queue is a 422, never page one
// again (page one again is how a client quietly re-reads the same page for ever).
import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Paginated } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { disputeNotFound, notADisputeParty, wrongCursor } from '../domain/errors.js';
import { parseDisputeNumber } from '../domain/types.js';
import type { DisputeStatus } from '../domain/types.js';
import { disputeDecisionLog } from '../infrastructure/postgres/schema/decisions.js';
import { disputeCases } from '../infrastructure/postgres/schema/disputes.js';
import { disputeMediationProposals } from '../infrastructure/postgres/schema/mediation.js';
import { disputeStatusChanges } from '../infrastructure/postgres/schema/statusChanges.js';
import {
  partyRole,
  toDecisionView,
  toDisputeView,
  toProposalView,
  toTimelineView,
  type DecisionView,
  type DisputeView,
  type ProposalView,
  type TimelineView,
} from './views.js';

export type ReadDb = Pick<Db, 'select'>;

interface PageInput {
  limit: number;
  cursor?: CursorKey | undefined;
}

/** `(created_at, id)` descending — newest case first, which is what both lists want. */
const newestCursor = (row: { createdAt: Date; id: string }): CursorKey => ({
  t: row.createdAt.toISOString(),
  id: row.id,
});

const readNewestCursor = (
  cursor: CursorKey | undefined,
  list: string,
): { t: string; id: string } | undefined => {
  if (cursor === undefined) return undefined;
  const { t, id, l } = cursor;
  const valid =
    Object.keys(cursor).sort().join(',') === 'id,l,t' &&
    typeof t === 'string' &&
    !Number.isNaN(Date.parse(t)) &&
    typeof id === 'string' &&
    l === list;
  if (!valid) throw wrongCursor();
  return { t, id };
};

const tagged = (list: string) => (row: { createdAt: Date; id: string }) => ({
  ...newestCursor(row),
  l: list,
});

/** Strictly before `(t, id)` in the descending order the query uses. */
const beforeNewest = (after: { t: string; id: string } | undefined): SQL | undefined =>
  after
    ? or(
        lt(disputeCases.createdAt, new Date(after.t)),
        and(eq(disputeCases.createdAt, new Date(after.t)), lt(sql`${disputeCases.id}::text`, after.id)),
      )
    : undefined;

export interface DisputeDetail extends DisputeView {
  /** Your side of it, so a screen never has to compare user ids to pick its copy (H1 vs H2). */
  yourRole: 'BUYER' | 'SELLER';
  decisions: DecisionView[];
  proposals: ProposalView[];
}

/**
 * One case, as a party. The decisions are included because H1 needs the rationale and the policy
 * citation beside the outcome, and a second round trip for the thing the screen is about is a
 * loading state nobody needs to see.
 */
export async function getDispute(
  db: ReadDb,
  input: { disputeId: string; userId: string; now?: Date },
): Promise<DisputeDetail> {
  const [row] = await db.select().from(disputeCases).where(eq(disputeCases.id, input.disputeId));
  if (!row) throw disputeNotFound();
  const role = partyRole(row, input.userId);
  if (role === null) throw notADisputeParty();

  const [decisions, proposals] = await Promise.all([
    db
      .select()
      .from(disputeDecisionLog)
      .where(eq(disputeDecisionLog.disputeId, row.id))
      .orderBy(asc(disputeDecisionLog.id)),
    db
      .select()
      .from(disputeMediationProposals)
      .where(eq(disputeMediationProposals.disputeId, row.id))
      .orderBy(asc(disputeMediationProposals.createdAt), asc(disputeMediationProposals.id)),
  ]);

  return {
    ...toDisputeView(row, input.now ?? new Date()),
    yourRole: role,
    decisions: decisions.map(toDecisionView),
    proposals: proposals.map(toProposalView),
  };
}

/** Every dispute this person is a party to, either side, newest first. */
export async function listDisputesForUser(
  db: ReadDb,
  input: PageInput & { userId: string; status?: DisputeStatus | undefined; now?: Date },
): Promise<Paginated<DisputeView>> {
  const after = readNewestCursor(input.cursor, 'mine');
  const now = input.now ?? new Date();

  const rows = await db
    .select()
    .from(disputeCases)
    .where(
      and(
        or(eq(disputeCases.buyerUserId, input.userId), eq(disputeCases.sellerUserId, input.userId)),
        input.status ? eq(disputeCases.status, input.status) : undefined,
        beforeNewest(after),
      ),
    )
    .orderBy(desc(disputeCases.createdAt), desc(disputeCases.id))
    .limit(input.limit + 1);

  return cursorPage(
    rows.map((row) => toDisputeView(row, now)),
    input.limit,
    tagged('mine'),
  );
}

/** The case's own history: every move it made, oldest first. This is Customer-8's timeline. */
export async function disputeTimeline(
  db: ReadDb,
  input: PageInput & { disputeId: string; userId: string },
): Promise<Paginated<TimelineView>> {
  const [row] = await db.select().from(disputeCases).where(eq(disputeCases.id, input.disputeId));
  if (!row) throw disputeNotFound();
  if (partyRole(row, input.userId) === null) throw notADisputeParty();

  const after = readTimelineCursor(input.cursor);
  const rows = await db
    .select()
    .from(disputeStatusChanges)
    .where(
      and(
        eq(disputeStatusChanges.disputeId, row.id),
        after === undefined ? undefined : gt(disputeStatusChanges.id, after),
      ),
    )
    .orderBy(asc(disputeStatusChanges.id))
    .limit(input.limit + 1);

  return cursorPage(rows.map(toTimelineView), input.limit, (entry) => ({ id: entry.id, l: 'timeline' }));
}

const readTimelineCursor = (cursor: CursorKey | undefined): number | undefined => {
  if (cursor === undefined) return undefined;
  const { id, l } = cursor;
  if (Object.keys(cursor).sort().join(',') !== 'id,l' || typeof id !== 'number' || l !== 'timeline') {
    throw wrongCursor();
  }
  return id;
};

export const REVIEWER_QUEUE_VIEWS = ['all', 'mine', 'unassigned', 'appeals'] as const;
export type ReviewerQueueView = (typeof REVIEWER_QUEUE_VIEWS)[number];

const LIVE_REVIEW: readonly DisputeStatus[] = ['UNDER_REVIEW', 'APPEALED', 'APPEAL_UNDER_REVIEW'];

const queueWhere = (view: ReviewerQueueView, reviewerId: string): SQL | undefined => {
  const live = inArray(disputeCases.status, [...LIVE_REVIEW]);
  switch (view) {
    case 'all':
      return live;
    case 'mine':
      return and(
        live,
        or(
          eq(disputeCases.assignedReviewerId, reviewerId),
          eq(disputeCases.assignedAppealLeadId, reviewerId),
        ),
      );
    case 'unassigned':
      return and(live, sql`${disputeCases.assignedReviewerId} IS NULL`);
    case 'appeals':
      return inArray(disputeCases.status, ['APPEALED', 'APPEAL_UNDER_REVIEW']);
  }
};

/**
 * The reviewer queue (M3 §9). Oldest first, deliberately — a review queue worked newest-first
 * starves the cases that have already waited longest, and these are cases where somebody's money
 * is held the whole time.
 */
export async function listReviewerQueue(
  db: ReadDb,
  input: PageInput & { view: ReviewerQueueView; reviewerId: string; q?: string | undefined; now?: Date },
): Promise<Paginated<DisputeView>> {
  const after = readNewestCursor(input.cursor, `queue:${input.view}`);
  const now = input.now ?? new Date();

  const number = input.q === undefined ? null : parseDisputeNumber(input.q);
  const search =
    input.q === undefined
      ? undefined
      : // A search that cannot be a case number matches nothing, rather than everything.
        number === null
        ? sql`false`
        : eq(disputeCases.disputeNumber, number);

  const rows = await db
    .select()
    .from(disputeCases)
    .where(
      and(
        queueWhere(input.view, input.reviewerId),
        search,
        after
          ? or(
              gt(disputeCases.createdAt, new Date(after.t)),
              and(eq(disputeCases.createdAt, new Date(after.t)), gt(sql`${disputeCases.id}::text`, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(disputeCases.createdAt), asc(disputeCases.id))
    .limit(input.limit + 1);

  return cursorPage(
    rows.map((row) => toDisputeView(row, now)),
    input.limit,
    tagged(`queue:${input.view}`),
  );
}

/** Cases whose `clock` has run out, for a deadline sweep. Oldest deadline first, bounded. */
export async function disputesPastDeadline(
  db: ReadDb,
  input: {
    status: DisputeStatus;
    clock: 'mediationDeadlineAt' | 'evidenceDeadlineAt' | 'appealDeadlineAt';
    now: Date;
    limit: number;
  },
): Promise<{ id: string }[]> {
  const column = disputeCases[input.clock];
  return db
    .select({ id: disputeCases.id })
    .from(disputeCases)
    .where(and(eq(disputeCases.status, input.status), lt(column, input.now)))
    .orderBy(asc(column))
    .limit(input.limit);
}
