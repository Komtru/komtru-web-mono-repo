import {
  CASE_PRIORITIES,
  CASE_STATES,
  CASE_TYPES,
  EVIDENCE_REQUEST_STATUSES,
  TRAIL_TYPES,
} from '../../../domain/types.js';
import { cases } from './columns.js';

export const caseType = cases.enum('case_type', [...CASE_TYPES]);
export const caseState = cases.enum('case_state', [...CASE_STATES]);
export const casePriority = cases.enum('case_priority', [...CASE_PRIORITIES]);
export const evidenceRequestStatus = cases.enum('evidence_request_status', [...EVIDENCE_REQUEST_STATUSES]);
export const trailType = cases.enum('case_trail_type', [...TRAIL_TYPES]);
