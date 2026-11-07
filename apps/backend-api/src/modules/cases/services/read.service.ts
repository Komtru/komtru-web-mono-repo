// The read side (T-107): the work queue behind P0-01, the universal list and the case read model
// behind P0-02. Reads take `Pick<Db, 'select'>`, so nothing here can write.
import { and, asc, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Paginated } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import { caseNotFound, wrongCursor } from '../domain/errors.js';
import { atRiskSeconds } from '../domain/sla.js';
import type { CasePriority, CaseState, CaseType } from '../domain/types.js';
import { caseIndex } from '../infrastructure/postgres/schema/cases.js';
import { caseDecisions } from '../infrastructure/postgres/schema/decisions.js';
import { caseEvidenceRequests } from '../infrastructure/postgres/schema/evidence.js';
import { caseTrail } from '../infrastructure/postgres/schema/trail.js';
import {
  toCaseView,
  toDecisionView,
  toEvidenceView,
  toTrailView,
  type CaseDetail,
  type CaseView,
  type TrailView,
} from './views.js';

export type ReadDb = Pick<Db, 'select'>;

export const QUEUE_VIEWS = ['mine', 'unassigned', 'escalated', 'sla_at_risk'] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

export interface CaseFilters {
  type?: CaseType | undefined;
  priority?: CasePriority | undefined;
  state?: CaseState | undefined;
  /** A user id, or `none` for unowned. */
  owner?: string | undefined;
  subjectType?: string | undefined;
  subjectId?: string | undefined;
  /** A case number: `C-002841`, `2841` or `002841`. */
  q?: string | undefined;
}

interface PageInput {
  limit: number;
  cursor?: CursorKey | undefined;
}

const live = sql`${caseIndex.state} NOT IN ('DECIDED', 'CLOSED')`;

/** The "SLA at risk" threshold in SQL, the same quarter-of-the-window rule `slaView` applies. */
const atRisk = sql`${caseIndex.slaDueAt} <= now() + ${caseIndex.slaHours} * ${atRiskSeconds(1)} * interval '1 second'`;

const viewWhere = (view: QueueView, userId: string): SQL | undefined => {
  switch (view) {
    case 'mine':
      return and(eq(caseIndex.ownerUserId, userId), live);
    case 'unassigned':
      return and(isNull(caseIndex.ownerUserId), live);
    case 'escalated':
      return and(eq(caseIndex.state, 'ESCALATED'), live);
    case 'sla_at_risk':
      return and(live, atRisk);
  }
};

/** `C-002841`, `002841` and `2841` all name case 2841; anything else names no case number. */
export function parseCaseNumber(q: string): number | null {
  const match = /^(?:c-?)?0*(\d{1,12})$/i.exec(q.trim());
  return match?.[1] ? Number(match[1]) : null;
}

function filterWhere(filters: CaseFilters): SQL[] {
  const clauses: SQL[] = [];
  if (filters.type) clauses.push(eq(caseIndex.type, filters.type));
  if (filters.priority) clauses.push(eq(caseIndex.priority, filters.priority));
  if (filters.state) clauses.push(eq(caseIndex.state, filters.state));
  if (filters.owner === 'none') clauses.push(isNull(caseIndex.ownerUserId));
  else if (filters.owner) clauses.push(eq(caseIndex.ownerUserId, filters.owner));
  if (filters.subjectType) clauses.push(eq(caseIndex.subjectType, filters.subjectType));
  if (filters.subjectId) clauses.push(eq(caseIndex.subjectId, filters.subjectId));
  if (filters.q) {
    const number = parseCaseNumber(filters.q);
    // A search that cannot be a case number matches nothing, rather than everything.
    clauses.push(number === null ? sql`false` : eq(caseIndex.caseNumber, number));
  }
  return clauses;
}

/** The queue is worked most-urgent-clock-first: `(sla_due_at, id)` ascending. */
const queueCursor = (row: { slaDueAt: Date; id: string }): CursorKey => ({
  d: row.slaDueAt.toISOString(),
  id: row.id,
});
const readQueueCursor = (cursor: CursorKey | undefined): { d: string; id: string } | undefined => {
  if (!cursor) return undefined;
  const { d, id } = cursor;
  const valid =
    typeof d === 'string' &&
    !Number.isNaN(Date.parse(d)) &&
    typeof id === 'string' &&
    /^[0-9a-f-]{36}$/i.test(id);
  if (!valid) throw wrongCursor();
  return { d, id };
};

export async function listQueue(
  db: ReadDb,
  input: PageInput & { view: QueueView; userId: string; filters: CaseFilters },
): Promise<Paginated<CaseView>> {
  const after = readQueueCursor(input.cursor);
  const now = new Date();
  const rows = await db
    .select()
    .from(caseIndex)
    .where(
      and(
        viewWhere(input.view, input.userId),
        ...filterWhere(input.filters),
        after
          ? sql`(${caseIndex.slaDueAt}, ${caseIndex.id}) > (${after.d}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(caseIndex.slaDueAt), asc(caseIndex.id))
    .limit(input.limit + 1);
  const page = cursorPage(rows, input.limit, queueCursor);
  return { items: page.items.map((row) => toCaseView(row, now)), nextCursor: page.nextCursor };
}

export interface QueueCounts {
  mine: number;
  mineUrgent: number;
  unassigned: number;
  escalated: number;
  slaAtRisk: number;
}

/** The four P0-01 tiles, in one pass over the live cases. */
export async function queueCounts(db: ReadDb, userId: string): Promise<QueueCounts> {
  const [counts] = await db
    .select({
      mine: sql<number>`(count(*) FILTER (WHERE ${caseIndex.ownerUserId} = ${userId}))::int`,
      mineUrgent: sql<number>`(count(*) FILTER (WHERE ${caseIndex.ownerUserId} = ${userId} AND ${caseIndex.priority} = 'URGENT'))::int`,
      unassigned: sql<number>`(count(*) FILTER (WHERE ${caseIndex.ownerUserId} IS NULL))::int`,
      escalated: sql<number>`(count(*) FILTER (WHERE ${caseIndex.state} = 'ESCALATED'))::int`,
      slaAtRisk: sql<number>`(count(*) FILTER (WHERE ${atRisk}))::int`,
    })
    .from(caseIndex)
    .where(live);
  return counts ?? { mine: 0, mineUrgent: 0, unassigned: 0, escalated: 0, slaAtRisk: 0 };
}

const listCursor = (row: { caseNumber: number }): CursorKey => ({ n: row.caseNumber });
const readListCursor = (cursor: CursorKey | undefined): number | undefined => {
  if (!cursor) return undefined;
  const n = cursor.n;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw wrongCursor();
  return n;
};

/** The universal list: every case, finished ones included, newest case number first. */
export async function listCases(
  db: ReadDb,
  input: PageInput & { filters: CaseFilters },
): Promise<Paginated<CaseView>> {
  const after = readListCursor(input.cursor);
  const now = new Date();
  const rows = await db
    .select()
    .from(caseIndex)
    .where(
      and(...filterWhere(input.filters), after === undefined ? undefined : lt(caseIndex.caseNumber, after)),
    )
    .orderBy(desc(caseIndex.caseNumber))
    .limit(input.limit + 1);
  const page = cursorPage(rows, input.limit, listCursor);
  return { items: page.items.map((row) => toCaseView(row, now)), nextCursor: page.nextCursor };
}

export async function getCaseDetail(db: ReadDb, caseId: string): Promise<CaseDetail> {
  const [row] = await db.select().from(caseIndex).where(eq(caseIndex.id, caseId));
  if (!row) throw caseNotFound();
  const evidence = await db
    .select()
    .from(caseEvidenceRequests)
    .where(eq(caseEvidenceRequests.caseId, caseId))
    .orderBy(asc(caseEvidenceRequests.createdAt));
  const decisions = await db
    .select()
    .from(caseDecisions)
    .where(eq(caseDecisions.caseId, caseId))
    .orderBy(asc(caseDecisions.decidedAt));
  return {
    ...toCaseView(row),
    facts: row.facts,
    evidenceRequests: evidence.map(toEvidenceView),
    decisions: decisions.map(toDecisionView),
  };
}

/** The trust trail, newest first. */
export async function listTrail(
  db: ReadDb,
  caseId: string,
  { limit, cursor }: PageInput,
): Promise<Paginated<TrailView>> {
  const [exists] = await db.select({ id: caseIndex.id }).from(caseIndex).where(eq(caseIndex.id, caseId));
  if (!exists) throw caseNotFound();
  let before: number | undefined;
  if (cursor) {
    if (typeof cursor.id !== 'number' || !Number.isSafeInteger(cursor.id)) throw wrongCursor();
    before = cursor.id;
  }
  const rows = await db
    .select()
    .from(caseTrail)
    .where(and(eq(caseTrail.caseId, caseId), before === undefined ? undefined : lt(caseTrail.id, before)))
    .orderBy(desc(caseTrail.id))
    .limit(limit + 1);
  const page = cursorPage(rows, limit, (row) => ({ id: row.id }));
  return { items: page.items.map(toTrailView), nextCursor: page.nextCursor };
}
