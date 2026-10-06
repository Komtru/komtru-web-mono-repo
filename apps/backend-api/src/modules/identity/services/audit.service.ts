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
