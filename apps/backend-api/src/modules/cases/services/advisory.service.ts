// Serves the advisory (T-107, Q9). It is handed a READ-ONLY handle and the provider, and imports no
// decision writer: "a decision can never be recorded by the advisory path" is true because nothing
// reachable from here can write one, and test/modules/cases/advisory-path.test.ts keeps it so.
import { and, count, eq } from 'drizzle-orm';
import { caseNotFound } from '../domain/errors.js';
import { ruleBasedAdvisory, type Advisory, type AdvisoryProvider } from '../domain/advisory.js';
import { slaView } from '../domain/sla.js';
import { caseIndex } from '../infrastructure/postgres/schema/cases.js';
import { caseDecisions } from '../infrastructure/postgres/schema/decisions.js';
import { caseEvidenceRequests } from '../infrastructure/postgres/schema/evidence.js';
import type { ReadDb } from './read.service.js';

export async function adviseOnCase(
  db: ReadDb,
  caseId: string,
  provider: AdvisoryProvider = ruleBasedAdvisory,
  now: Date = new Date(),
): Promise<Advisory> {
  const [row] = await db.select().from(caseIndex).where(eq(caseIndex.id, caseId));
  if (!row) throw caseNotFound();

  const evidence = await db
    .select({ status: caseEvidenceRequests.status, n: count() })
    .from(caseEvidenceRequests)
    .where(eq(caseEvidenceRequests.caseId, caseId))
    .groupBy(caseEvidenceRequests.status);
  const [decisions] = await db
    .select({ n: count() })
    .from(caseDecisions)
    .where(and(eq(caseDecisions.caseId, caseId)));
  const evidenceCount = (status: string) => evidence.find((e) => e.status === status)?.n ?? 0;

  return provider.suggest({
    type: row.type,
    state: row.state,
    priority: row.priority,
    sla: slaView({ state: row.state, dueAt: row.slaDueAt, slaHours: row.slaHours, now }).status,
    ageHours: Math.floor((now.getTime() - row.createdAt.getTime()) / 3_600_000),
    openEvidenceRequests: evidenceCount('OPEN'),
    resolvedEvidenceRequests: evidenceCount('FULFILLED') + evidenceCount('CANCELLED'),
    priorDecisions: decisions?.n ?? 0,
    facts: row.facts,
  });
}
