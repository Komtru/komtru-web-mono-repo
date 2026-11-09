// The cases module's public surface (T-107). Owning modules register their records as cases through
// `registerCase` inside their own transaction, keep the advisory's facts current with
// `syncCaseFacts`, and close the case with `closeCaseForSubject` once they have acted on a decision.
// They get the schema and the events too, and nothing else: the komtru/module-boundaries rule makes
// this the only way in.
import { createCasesModule } from './module.js';

export * from './infrastructure/postgres/schema/index.js';
export * from './domain/types.js';
export * from './domain/events.js';
export { SLA_HOURS } from './domain/sla.js';
export { ADVISORY_LABEL, type Advisory, type AdvisoryProvider } from './domain/advisory.js';
/**
 * `registerCase` is idempotent on (type, subject). When the subject already has a DECIDED or CLOSED
 * case it returns that case unchanged with `created: false` and `reopenRequired: true`: nothing is
 * reopened for you, so check the flag before assuming staff will see new work.
 */
export {
  closeCaseForSubject,
  registerCase,
  syncCaseFacts,
  type CaseSubject,
  type RegisterCaseInput,
  type RegisterResult,
} from './services/register.service.js';
/** With `actor: null`, pass `source` (your module's name): it is written to the trail. */
export { decideCase, escalateCase, resolveEvidenceRequest, takeCase } from './services/case.service.js';
/** T-052: the KYC queue serves the advisory beside its own item and records its decisions as cases'. */
export { adviseOnCase } from './services/advisory.service.js';
export type { CaseActor } from './services/audit.js';
export { createCasesModule };

export const casesModule = createCasesModule();
