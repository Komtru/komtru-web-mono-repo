// §S10: every auth-sensitive action writes `identity.identity_audit_log` before the request returns
// success, and an audit failure fails the request. That last half is what taking the caller's `Tx`
// buys — the row and the thing it describes commit together or neither does, so there is no path
// where a password changed and nothing recorded it.
//
// §S12 governs what may be in here. `metadata` holds ids, hashes, counts, reasons and enum values.
// It never holds an email, a phone number, an OTP code, a password or a token. The append-only
// trigger (T-030, migration 0012) means a row written by mistake cannot be taken back, which is the
// point of an audit log and the reason the rule is absolute rather than a convention.
import { identityAuditLog } from '../infrastructure/postgres/schema/audit.js';
import type { Tx } from '../../../platform/events/publish.js';

export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

/** SYSTEM for a job or a sweep; ANONYMOUS for a caller who presented no credential. */
export type AuditActorType = 'USER' | 'STAFF' | 'SYSTEM' | 'ANONYMOUS';

export interface AuditInput {
  action: string;
  outcome: AuditOutcome;
  actorType?: AuditActorType;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  /**
   * Already run through `net.isIP` by the controller (http/controllers/request.ts). This column is
   * `inet`, and an unparseable value is a 22P02 from Postgres and a 500 from us.
   */
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  sessionId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * The actions this module writes. A constant rather than free strings so a query for "every failed
 * sign-in" cannot miss rows because one call site wrote `LOGIN_FAIL`.
 */
export const AUDIT_ACTIONS = {
  REGISTERED: 'USER_REGISTERED',
  OTP_ISSUED: 'OTP_ISSUED',
  OTP_VERIFIED: 'OTP_VERIFIED',
  OTP_FAILED: 'OTP_FAILED',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PASSWORD_SET: 'PASSWORD_SET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  TERMS_ACCEPTED: 'TERMS_ACCEPTED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  PHONE_VERIFIED: 'PHONE_VERIFIED',
  // T-036.
  DEVICE_REGISTERED: 'DEVICE_REGISTERED',
  DEVICE_RETIRED: 'DEVICE_RETIRED',
  DEVICE_TRUSTED: 'DEVICE_TRUSTED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  MFA_CHALLENGED: 'MFA_CHALLENGED',
  MFA_VERIFIED: 'MFA_VERIFIED',
  MFA_FAILED: 'MFA_FAILED',
  MFA_ENROLLED: 'MFA_ENROLLED',
  MFA_REMOVED: 'MFA_REMOVED',
  MFA_RECOVERY_CODES_ISSUED: 'MFA_RECOVERY_CODES_ISSUED',
  STEP_UP_VERIFIED: 'STEP_UP_VERIFIED',
  STEP_UP_FAILED: 'STEP_UP_FAILED',
  // T-037. Every admin call writes exactly one of these, with the stated reason in `metadata`.
  ADMIN_USER_SEARCHED: 'ADMIN_USER_SEARCHED',
  ADMIN_USER_VIEWED: 'ADMIN_USER_VIEWED',
  /** One row per field revealed (M1 section 12.3 note 1), not one per request. */
  ADMIN_PII_VIEWED: 'ADMIN_PII_VIEWED',
  ADMIN_STATUS_CHANGED: 'ADMIN_STATUS_CHANGED',
  ADMIN_SESSIONS_REVOKED: 'ADMIN_SESSIONS_REVOKED',
  ADMIN_AUDIT_LOG_VIEWED: 'ADMIN_AUDIT_LOG_VIEWED',
  ADMIN_LINKED_ACCOUNTS_VIEWED: 'ADMIN_LINKED_ACCOUNTS_VIEWED',
  ADMIN_APPROVALS_LISTED: 'ADMIN_APPROVALS_LISTED',
  ADMIN_ACTION_DENIED: 'ADMIN_ACTION_DENIED',
  ROLE_GRANTED: 'ROLE_GRANTED',
  SUPER_ADMIN_BOOTSTRAPPED: 'SUPER_ADMIN_BOOTSTRAPPED',
  ROLE_REVOKED: 'ROLE_REVOKED',
  USERNAME_RESERVED: 'USERNAME_RESERVED',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_APPROVED: 'APPROVAL_APPROVED',
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  // T-038.
  STAFF_INVITATION_CREATED: 'STAFF_INVITATION_CREATED',
  STAFF_INVITATION_CANCELLED: 'STAFF_INVITATION_CANCELLED',
  STAFF_INVITATION_ACCEPTED: 'STAFF_INVITATION_ACCEPTED',
  STAFF_INVITATION_BOUND: 'STAFF_INVITATION_BOUND',
  ADMIN_STAFF_INVITATIONS_LISTED: 'ADMIN_STAFF_INVITATIONS_LISTED',
  // T-042. `metadata` names the address id and the fields touched, never their values (§S12).
  ADDRESS_ADDED: 'ADDRESS_ADDED',
  ADDRESS_UPDATED: 'ADDRESS_UPDATED',
  ADDRESS_ARCHIVED: 'ADDRESS_ARCHIVED',
  ADDRESS_DEFAULT_SET: 'ADDRESS_DEFAULT_SET',
  // T-041. `metadata` carries file ids and the source, never a URL (a provider URL is untrusted input).
  AVATAR_SET: 'AVATAR_SET',
  AVATAR_REMOVED: 'AVATAR_REMOVED',
  // T-039. `metadata` carries the reason, from/to and counts, never a handle or an address (§S12).
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_CLOSED: 'ACCOUNT_CLOSED',
  ACCOUNT_ANONYMISED: 'ACCOUNT_ANONYMISED',
  DATA_EXPORT_REQUESTED: 'DATA_EXPORT_REQUESTED',
  ERASURE_REQUESTED: 'ERASURE_REQUESTED',
  RECOVERY_REQUESTED: 'RECOVERY_REQUESTED',
  RECOVERY_DECIDED: 'RECOVERY_DECIDED',
  ADMIN_RECOVERY_LISTED: 'ADMIN_RECOVERY_LISTED',
} as const;

export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.insert(identityAuditLog).values({
    action: input.action,
    outcome: input.outcome,
    actorType: input.actorType ?? 'SYSTEM',
    actorUserId: input.actorUserId ?? null,
    subjectUserId: input.subjectUserId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    deviceId: input.deviceId ?? null,
    sessionId: input.sessionId ?? null,
    correlationId: input.correlationId ?? null,
    metadata: input.metadata ?? null,
  });
}
