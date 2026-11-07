// Which moves a case may make. Pure, so the rules are tested without a database; the service takes
// the row lock and calls these.
import { FINISHED_STATES, type CaseState } from './types.js';
import { caseFinished } from './errors.js';

export const isFinished = (state: CaseState): boolean => FINISHED_STATES.includes(state);

/** Work done on a case (take, reassign, escalate, ask for evidence, change priority) needs it live. */
export function assertWorkable(state: CaseState): void {
  if (isFinished(state)) throw caseFinished(state);
}

/** Taking or being assigned a case that nobody had started moves it from OPEN to INVESTIGATING. */
export const stateAfterAssignment = (state: CaseState): CaseState =>
  state === 'OPEN' ? 'INVESTIGATING' : state;

export const stateAfterEscalation = (state: CaseState): CaseState => {
  assertWorkable(state);
  return 'ESCALATED';
};

/** Asking for evidence parks a case awaiting it, unless it is already with an expert. */
export const stateAfterEvidenceRequested = (state: CaseState): CaseState =>
  state === 'ESCALATED' ? state : 'AWAITING_EVIDENCE';

/** The last open request resolving puts the case back to work. */
export const stateAfterEvidenceResolved = (state: CaseState, openRemaining: number): CaseState =>
  state === 'AWAITING_EVIDENCE' && openRemaining === 0 ? 'INVESTIGATING' : state;
