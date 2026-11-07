// What an owning module calls (T-107, M15 "index, not copy"): register a record as a case, keep the
// few facts the advisory reads current, and close the case when the owner has acted on a decision.
// Each takes the caller's transaction, so the case commits or rolls back with the record it indexes.
import { and, eq, sql } from 'drizzle-orm';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { caseClosed, caseRegistered } from '../domain/events.js';
import { caseNotFound } from '../domain/errors.js';
import { SLA_HOURS, slaDueAt } from '../domain/sla.js';
import { MAX_FACT_KEYS, type CaseFacts, type CasePriority, type CaseType } from '../domain/types.js';
import { caseIndex } from '../infrastructure/postgres/schema/cases.js';
import { writeTrail } from './audit.js';
import type { CaseRow } from './views.js';

export interface CaseSubject {
  type: CaseType;
  /** The owning module's name for its record: `dispute`, `custody_parcel`, `kyb_review`. */
  subjectType: string;
  subjectId: string;
}

export interface RegisterCaseInput extends CaseSubject {
  title: string;
  priority?: CasePriority;
  /** Overrides the type's default SLA; the owner knows when a clock should be shorter. */
  slaHours?: number;
  facts?: CaseFacts;
}

export function assertFacts(facts: CaseFacts): void {
  if (Object.keys(facts).length > MAX_FACT_KEYS) {
    throw new RangeError(`cases: at most ${MAX_FACT_KEYS} facts per case`);
  }
}

export const eventRef = (row: CaseRow) => ({
  caseId: row.id,
  caseNumber: row.caseNumber,
  type: row.type,
  subjectType: row.subjectType,
  subjectId: row.subjectId,
});

const subjectWhere = (subject: CaseSubject) =>
  and(
    eq(caseIndex.type, subject.type),
    eq(caseIndex.subjectType, subject.subjectType),
    eq(caseIndex.subjectId, subject.subjectId),
  );

/**
 * Idempotent on (type, subject): registering a record twice returns the case it already has, writes
 * nothing and publishes nothing, so an owning module may retry or re-run a backfill freely.
 */
export async function registerCase(
  tx: Tx,
  input: RegisterCaseInput,
): Promise<{ case: CaseRow; created: boolean }> {
  const facts = input.facts ?? {};
  assertFacts(facts);
  const slaHours = input.slaHours ?? SLA_HOURS[input.type];
  const startedAt = new Date();

  const [created] = await tx
    .insert(caseIndex)
    .values({
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      title: input.title.trim(),
      priority: input.priority ?? 'NORMAL',
      slaHours,
      slaStartedAt: startedAt,
      slaDueAt: slaDueAt(startedAt, slaHours),
      facts,
    })
    .onConflictDoNothing()
    .returning();

  if (!created) {
    const [existing] = await tx.select().from(caseIndex).where(subjectWhere(input));
    if (!existing) throw new Error('cases: a case conflicted on registration and then vanished');
    return { case: existing, created: false };
  }

  await writeTrail(tx, {
    caseId: created.id,
    type: 'REGISTERED',
    actorUserId: null,
    metadata: { priority: created.priority, slaHours },
  });
  await publish(tx, caseRegistered, {
    payload: { ...eventRef(created), priority: created.priority, slaDueAt: created.slaDueAt.toISOString() },
    aggregateType: 'cases.case',
    aggregateId: created.id,
  });
  return { case: created, created: true };
}

/**
 * Merges facts into a case's advisory inputs. The keys changed are on the trail; the values are not
 * (the owning module's record is the source, and a fact may be something its owner would not want
 * copied into an append-only table).
 */
export async function syncCaseFacts(tx: Tx, subject: CaseSubject, facts: CaseFacts): Promise<CaseRow> {
  const [row] = await tx.select().from(caseIndex).where(subjectWhere(subject)).for('update');
  if (!row) throw caseNotFound();
  const merged = { ...row.facts, ...facts };
  assertFacts(merged);
  const [updated] = await tx
    .update(caseIndex)
    .set({ facts: merged, updatedAt: sql`now()` })
    .where(eq(caseIndex.id, row.id))
    .returning();
  if (!updated) throw caseNotFound();
  await writeTrail(tx, {
    caseId: row.id,
    type: 'FACTS_UPDATED',
    actorUserId: null,
    metadata: { keys: Object.keys(facts) },
  });
  return updated;
}

/**
 * The owning module has acted on the case (or resolved it without staff). Idempotent: a case already
 * closed stays as it is.
 */
export async function closeCaseForSubject(
  tx: Tx,
  subject: CaseSubject,
  outcome: string | null = null,
): Promise<CaseRow> {
  const [row] = await tx.select().from(caseIndex).where(subjectWhere(subject)).for('update');
  if (!row) throw caseNotFound();
  if (row.state === 'CLOSED') return row;
  const [closed] = await tx
    .update(caseIndex)
    .set({ state: 'CLOSED', closedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(caseIndex.id, row.id))
    .returning();
  if (!closed) throw caseNotFound();
  await writeTrail(tx, {
    caseId: row.id,
    type: 'CLOSED',
    actorUserId: null,
    metadata: { outcome, from: row.state },
  });
  await publish(tx, caseClosed, {
    payload: { ...eventRef(closed), outcome },
    aggregateType: 'cases.case',
    aggregateId: closed.id,
  });
  return closed;
}
