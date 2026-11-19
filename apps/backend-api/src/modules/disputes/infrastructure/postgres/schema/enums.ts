// The Postgres enums, built from the domain's own `as const` tuples so the database and the code
// cannot drift: adding a status in domain/types.ts and forgetting the migration is a type error at
// generate time, not a runtime surprise.
import {
  APPEAL_OUTCOMES,
  DECISION_OUTCOMES,
  DECISION_TYPES,
  DISPUTE_ACTOR_TYPES,
  DISPUTE_CATEGORIES,
  DISPUTE_CREATION_PATHS,
  DISPUTE_STATUSES,
  MEDIATION_PROPOSAL_STATUSES,
} from '../../../domain/types.js';
import { disputes } from './columns.js';

export const disputeStatus = disputes.enum('dispute_status', [...DISPUTE_STATUSES]);
export const disputeCategory = disputes.enum('dispute_category', [...DISPUTE_CATEGORIES]);
export const disputeCreationPath = disputes.enum('dispute_creation_path', [...DISPUTE_CREATION_PATHS]);
export const decisionOutcome = disputes.enum('decision_outcome', [...DECISION_OUTCOMES]);
export const decisionType = disputes.enum('decision_type', [...DECISION_TYPES]);
export const appealOutcome = disputes.enum('appeal_outcome', [...APPEAL_OUTCOMES]);
export const mediationProposalStatus = disputes.enum('mediation_proposal_status', [
  ...MEDIATION_PROPOSAL_STATUSES,
]);
export const disputeActorType = disputes.enum('dispute_actor_type', [...DISPUTE_ACTOR_TYPES]);
