// Separation of duties at the permission layer (M1 C5, section 12.3 footnotes, section 5.7).
//
// The catalogue says who HOLDS a permission. This file says what else must be true before a holder
// may USE it, and it is pure so the whole rule set is testable without a database. The database
// backs three of these rules with constraints (no self grant, a distinct approver, the dual-approval
// trigger) and this is the layer that refuses first, with a reason the caller can act on.
import {
  ROLES,
  ROLE_CODES,
  conditionFor,
  grantFor,
  isKnownPermission,
  isKnownRole,
  type GrantCondition,
  type PermissionCode,
  type RoleCode,
} from './catalog.js';

/** M1 section 12.1's "dual approval to grant" column, read off the catalogue rather than restated. */
export const DUAL_APPROVAL_ROLES: readonly RoleCode[] = ROLES.filter((role) => role.requiresDualApproval).map(
  (role) => role.code,
);

/**
 * The longest a time-boxed role grant may run. A grant with no `expiresAt` gets this horizon (C6: never
 * permanent), and an explicit one must end within it, so "temporary" cannot mean "until 2099".
 */
export const MAX_ROLE_GRANT_DAYS = 365;

/**
 * M1 section 12.1: "Break-glass. Two people maximum." Enforced where a SUPER_ADMIN row is written,
 * under a lock, because a count taken outside the write is a race two granters can both win.
 */
export const MAX_SUPER_ADMINS = 2;

/**
 * The permissions that are reads of the actor's own account and stay allowed on oneself. Everything
 * else refuses `subject === actor`: an admin restricted by someone else must not be able to lift it,
 * and must not be able to grant themselves a capability or approve their own request.
 */
const SELF_READ_ALLOWED: ReadonlySet<string> = new Set([
  'user.view',
  'user.search',
  'session.view',
  'audit.view',
  'role.view',
]);

/**
 * Actions on a user that are the kind a lesser admin could use to neutralise a more privileged one
 * (lock them out, reset their factor, rename them). When the subject holds a live staff role, only a
 * SUPER_ADMIN may do these. `role.*` is deliberately absent: COMPLIANCE_OFFICER revoking a role is
 * the offboarding path (section 12.3 note 5).
 */
const STAFF_PROTECTED: ReadonlySet<string> = new Set([
  'user.restrict',
  'user.suspend',
  'user.reinstate',
  'user.close',
  'session.revoke',
  'mfa.reset',
  'username.force_change',
  'credential.force_reset',
]);

export const staffTargetDenied = (
  permission: string,
  subjectIsStaff: boolean | undefined,
  roles: readonly string[],
): boolean => subjectIsStaff === true && STAFF_PROTECTED.has(permission) && !roles.includes('SUPER_ADMIN');

/**
 * The actions that run as two steps through `admin_action_approvals` (T-037, M1 section 10.6): one
 * holder requests, a different holder approves. `identityOwned` actions are executed by identity at
 * approval; the others are consumed by the module that owns the action (`consumeApproval`).
 */
export const TWO_STEP_ACTIONS = {
  // M1 section 12.3 note 3: the identity challenge with the user comes first, and is attested.
  MFA_RESET: { permission: 'mfa.reset', identityOwned: true, identityChallenge: true },
  USERNAME_FORCE_CHANGE: {
    permission: 'username.force_change',
    identityOwned: true,
    identityChallenge: false,
  },
  VERIFICATION_OVERRIDE: {
    permission: 'verification.override',
    identityOwned: false,
    identityChallenge: false,
  },
  // M8 section 10 sets no threshold for "large", so every refund is two-step until it does.
  LARGE_REFUND: { permission: 'payment.refund', identityOwned: false, identityChallenge: false },
  // Owner decision pending: money-moving finance actions are two-step rather than one person's call.
  PAYOUT_RETRY: { permission: 'payout.retry', identityOwned: false, identityChallenge: false },
  RECONCILIATION_RESOLVE: {
    permission: 'reconciliation.resolve',
    identityOwned: false,
    identityChallenge: false,
  },
} as const satisfies Record<
  string,
  { permission: PermissionCode; identityOwned: boolean; identityChallenge: boolean }
>;

export type TwoStepAction = keyof typeof TWO_STEP_ACTIONS;

export const twoStepActionFor = (permission: string): TwoStepAction | undefined =>
  (Object.keys(TWO_STEP_ACTIONS) as TwoStepAction[]).find(
    (action) => TWO_STEP_ACTIONS[action].permission === permission,
  );

/**
 * True when using the permission needs a second holder's approval: either a role's grant carries the
 * approval condition (M1 section 12.3 note 3) or the action is in the two-step registry, as the
 * forced username change is (section 10.6) although its matrix cell is a plain tick.
 */
export const needsApproval = (permission: string): boolean =>
  isKnownPermission(permission) &&
  (twoStepActionFor(permission) !== undefined ||
    ROLE_CODES.some((role) => conditionFor(role, permission) === 'ADMIN_ACTION_APPROVAL'));

export interface TradeSelfDealingContext {
  tradePartyUserIds: readonly string[];
  sharesDeviceWithActor: boolean;
  sharesPayoutInstrumentWithActor: boolean;
}

/** The second holder's sign-off on a two-step action, as `approval.service` proved it. */
export interface ApprovalProof {
  approvedByUserId: string;
  approvedByRoles: readonly string[];
  /** The identity challenge with the subject (M1 section 12.3 note 3) was completed. */
  identityChallengeConfirmed: boolean;
}

export interface TicketContext {
  open: boolean;
  referencesSubject: boolean;
  /** Footnote 4: the ticket records a documented request from the user. */
  documentedUserRequest?: boolean;
}

export type DenyReason =
  | 'PERMISSION_DENIED'
  | 'CONDITION_NOT_MET'
  | 'APPROVAL_REQUIRED'
  | 'SELF_ACTION'
  | 'STAFF_TARGET'
  | 'SELF_DEALING';

export type AdminAuthorization = { allowed: true } | { allowed: false; reason: DenyReason };

export interface AdminActionInput {
  actorUserId: string;
  roles: readonly string[];
  permission: string;
  subjectUserId?: string;
  approval?: ApprovalProof;
  ticket?: TicketContext;
  /** Footnote 2: the session is read-only and inside its 15 minutes. The caller enforces both. */
  readOnlyTimeBoxed?: boolean;
  trade?: TradeSelfDealingContext;
  /** The subject holds a live staff role. Callers that act on a user look this up. */
  subjectIsStaff?: boolean;
}

const holds = (roles: readonly string[], permission: PermissionCode): boolean =>
  roles.some((role) => isKnownRole(role) && grantFor(role, permission) !== 'DENY');

/**
 * Whether `proof` is a valid second signature on `permission` for an action the requester started on
 * `subjectUserId`: a different person from both, holding the permission, and having completed the
 * identity challenge where the action's registry entry asks for one.
 */
export function approvalSatisfies(input: {
  permission: PermissionCode;
  requesterUserId: string;
  subjectUserId?: string | undefined;
  proof?: ApprovalProof | undefined;
}): boolean {
  const { proof } = input;
  if (proof === undefined) return false;
  const action = twoStepActionFor(input.permission);
  const challengeRequired = action !== undefined && TWO_STEP_ACTIONS[action].identityChallenge;
  return (
    (!challengeRequired || proof.identityChallengeConfirmed) &&
    proof.approvedByUserId !== input.requesterUserId &&
    proof.approvedByUserId !== input.subjectUserId &&
    holds(proof.approvedByRoles, input.permission)
  );
}

const approvalIsValid = (input: AdminActionInput, permission: PermissionCode): boolean =>
  approvalSatisfies({
    permission,
    requesterUserId: input.actorUserId,
    subjectUserId: input.subjectUserId,
    proof: input.approval,
  });

const conditionHolds = (condition: GrantCondition, input: AdminActionInput): boolean => {
  switch (condition) {
    case 'TICKET_SCOPED_PII':
      return input.ticket?.open === true && input.ticket.referencesSubject;
    case 'DOCUMENTED_USER_REQUEST':
      return (
        input.ticket?.open === true &&
        input.ticket.referencesSubject &&
        input.ticket.documentedUserRequest === true
      );
    case 'READ_ONLY_TIME_BOXED':
      return input.readOnlyTimeBoxed === true;
    case 'ADMIN_ACTION_APPROVAL':
      // Settled by the approval gate below, which also covers two-step actions with plain grants.
      return true;
  }
};

/**
 * Whether this actor may do this now. Deny by default: an unknown permission, an unknown role and a
 * missing fact all answer no.
 *
 * Order matters for the reason the caller gets, not for the outcome: permission, then self-action,
 * then the footnote conditions, then the approval, then self-dealing last so a conflicted actor is
 * refused even holding a valid approval.
 */
export function authorizeAdminAction(input: AdminActionInput): AdminAuthorization {
  if (!isKnownPermission(input.permission)) return { allowed: false, reason: 'PERMISSION_DENIED' };
  const permission = input.permission;

  const roles = input.roles.filter(isKnownRole);
  const grants = roles
    .map((role) => ({ role, grant: grantFor(role, permission) }))
    .filter(({ grant }) => grant !== 'DENY');
  if (grants.length === 0) return { allowed: false, reason: 'PERMISSION_DENIED' };

  if (input.subjectUserId === input.actorUserId && !SELF_READ_ALLOWED.has(permission)) {
    return { allowed: false, reason: 'SELF_ACTION' };
  }
  if (staffTargetDenied(permission, input.subjectIsStaff, roles)) {
    return { allowed: false, reason: 'STAFF_TARGET' };
  }

  // One grant that is satisfied is enough, so a role holding the permission outright is not held
  // back by another role's condition.
  const satisfied = grants.some(({ role }) => {
    const condition = conditionFor(role, permission);
    return condition === undefined || conditionHolds(condition, input);
  });
  if (!satisfied) return { allowed: false, reason: 'CONDITION_NOT_MET' };

  if (needsApproval(permission) && !approvalIsValid(input, permission)) {
    return { allowed: false, reason: 'APPROVAL_REQUIRED' };
  }

  const trade = input.trade;
  if (
    trade &&
    (trade.tradePartyUserIds.includes(input.actorUserId) ||
      trade.sharesDeviceWithActor ||
      trade.sharesPayoutInstrumentWithActor)
  ) {
    return { allowed: false, reason: 'SELF_DEALING' };
  }

  return { allowed: true };
}

export type RoleGrantVerdict =
  | { ok: true; needsSecondApprover: boolean; expiresAt: Date }
  | {
      ok: false;
      reason: 'UNKNOWN_ROLE' | 'SELF_GRANT' | 'INVALID_EXPIRY' | 'APPROVER_NOT_DISTINCT';
    };

export interface RoleGrantInput {
  roleCode: string;
  userId: string;
  grantedBy: string;
  approvedBy?: string;
  expiresAt?: Date;
  now: Date;
}

/**
 * M1 section 5.7 and 10.6 for `POST /admin/users/{id}/roles`. The database enforces the same three
 * distinctness rules with CHECK constraints and the dual-approval rule with a trigger; this refuses
 * first, with a reason, instead of surfacing a constraint violation.
 */
export function validateRoleGrant(input: RoleGrantInput): RoleGrantVerdict {
  if (!isKnownRole(input.roleCode)) return { ok: false, reason: 'UNKNOWN_ROLE' };
  if (input.grantedBy === input.userId) return { ok: false, reason: 'SELF_GRANT' };

  // C6: every grant is time-boxed. No `expiresAt` means the longest allowed, never "forever".
  const horizon = input.now.getTime() + MAX_ROLE_GRANT_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = input.expiresAt ?? new Date(horizon);
  if (expiresAt.getTime() <= input.now.getTime() || expiresAt.getTime() > horizon) {
    return { ok: false, reason: 'INVALID_EXPIRY' };
  }

  if (!DUAL_APPROVAL_ROLES.includes(input.roleCode))
    return { ok: true, needsSecondApprover: false, expiresAt };
  if (input.approvedBy === undefined) return { ok: true, needsSecondApprover: true, expiresAt };
  if (input.approvedBy === input.grantedBy || input.approvedBy === input.userId) {
    return { ok: false, reason: 'APPROVER_NOT_DISTINCT' };
  }
  return { ok: true, needsSecondApprover: false, expiresAt };
}
