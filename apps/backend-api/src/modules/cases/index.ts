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
export {
  closeCaseForSubject,
  registerCase,
  syncCaseFacts,
  type CaseSubject,
  type RegisterCaseInput,
} from './services/register.service.js';
export { resolveEvidenceRequest } from './services/case.service.js';
export { createCasesModule };

export const casesModule = createCasesModule();
