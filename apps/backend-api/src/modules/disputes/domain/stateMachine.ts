// The dispute lifecycle (M3 §3, widened by design conflict C13). Pure: no database, no clock, no
// I/O. This map is the single definition of the machine, in the shape trades/domain/stateMachine.ts
// established, so a service that forgets the guard and a job that sweeps a deadline are refused the
// same jumps by the same function.
//
// `canTransition(action, from)` returns the states that action may reach, rather than a boolean,
// because the caller names the target it intends and the whole triple is validated. Today every
// dispute action has exactly one outcome; returning the list keeps the shape honest for the day an
// appeal outcome splits `CLOSED` in two, and keeps it identical to the trades machine a reader has
// already learned.
import { DISPUTE_ACTIONS, DISPUTE_STATUSES, type DisputeAction, type DisputeStatus } from './types.js';

export { DISPUTE_ACTIONS, DISPUTE_STATUSES, type DisputeAction, type DisputeStatus };

type TransitionMap = Readonly<
  Record<DisputeAction, Readonly<Partial<Record<DisputeStatus, readonly DisputeStatus[]>>>>
>;

export const TRANSITIONS: TransitionMap = {
  // `OPEN` creates the case in MEDIATION; there is no earlier state to leave, so it has no edges.
  // It stays in the action list because the status-change log records the opening with a name, and
  // a log entry whose action is not in the vocabulary would be unreadable.
  OPEN: {},

  // C13: the parties' own 48 hours. An agreed outcome resolves the case without a reviewer ever
  // seeing it; a withdrawal closes it outright (SP-M23); silence escalates it to evidence.
  AGREE: { MEDIATION: ['DECIDED'] },
  WITHDRAW: { MEDIATION: ['CLOSED'] },
  MEDIATION_LAPSED: { MEDIATION: ['OPEN_EVIDENCE_COLLECTION'] },

  // M3 D2: the window closes on its deadline, or early when both parties mark themselves done.
  CLOSE_EVIDENCE: { OPEN_EVIDENCE_COLLECTION: ['UNDER_REVIEW'] },
  // Late evidence is never auto-accepted: the assigned reviewer reopens collection, and the reopen
  // is a logged transition rather than a silent flag on a row.
  REOPEN_EVIDENCE: { UNDER_REVIEW: ['OPEN_EVIDENCE_COLLECTION'] },

  DECIDE: { UNDER_REVIEW: ['DECIDED'] },

  // M3 D5: one appeal, from a decided case only, reviewed by a lead who was not the original
  // reviewer. `CLOSED` is final — there is deliberately no edge out of it anywhere in this table.
  APPEAL: { DECIDED: ['APPEALED'] },
  ASSIGN_APPEAL: { APPEALED: ['APPEAL_UNDER_REVIEW'] },
  DECIDE_APPEAL: { APPEAL_UNDER_REVIEW: ['CLOSED'] },

  // An unappealed decision closes by itself when its window lapses.
  LAPSE: { DECIDED: ['CLOSED'] },
};

const NONE: readonly DisputeStatus[] = [];

/** The states `action` may reach from `from`; empty when the action does not apply there. */
export const canTransition = (action: DisputeAction, from: DisputeStatus): readonly DisputeStatus[] =>
  TRANSITIONS[action][from] ?? NONE;

export const isTransitionAllowed = (action: DisputeAction, from: DisputeStatus, to: DisputeStatus): boolean =>
  canTransition(action, from).includes(to);

/**
 * The states an action may leave to reach `to`, in lifecycle order. This is what makes the guarded
 * UPDATE possible: `WHERE id = $1 AND status IN (…)` lets the database decide the race, so no
 * service ever reads a status and then writes one.
 */
export const sourceStatuses = (action: DisputeAction, to: DisputeStatus): readonly DisputeStatus[] =>
  DISPUTE_STATUSES.filter((from) => isTransitionAllowed(action, from, to));

/** A state with no way out. Everything downstream — deadlines, sweeps, notifications — stops here. */
export const TERMINAL_STATUSES: readonly DisputeStatus[] = DISPUTE_STATUSES.filter((status) =>
  DISPUTE_ACTIONS.every((action) => canTransition(action, status).length === 0),
);

export const isTerminal = (status: DisputeStatus): boolean => TERMINAL_STATUSES.includes(status);

/** Every edge, as (action, from, to) triples — the form the invariant tests walk. */
export const transitionTriples = (): [DisputeAction, DisputeStatus, DisputeStatus][] =>
  DISPUTE_ACTIONS.flatMap((action) =>
    DISPUTE_STATUSES.flatMap((from) =>
      canTransition(action, from).map((to): [DisputeAction, DisputeStatus, DisputeStatus] => [
        action,
        from,
        to,
      ]),
    ),
  );
