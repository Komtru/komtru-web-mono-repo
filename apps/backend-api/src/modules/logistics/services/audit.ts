// Every admin change to a company or its team is one transaction holding the row, identity's audit
// row (until M14's own log exists) and the outbox event — the geo catalog's pattern. A change nobody
// can explain afterwards does not happen.
import type { EventActor } from '@komtru/shared-types';
import type { Tx } from '../../../platform/events/publish.js';
import { writeAudit } from '../../identity/index.js';

export const LOGISTICS_AUDIT = {
  COMPANY_ONBOARDED: 'LOGISTICS_COMPANY_ONBOARDED',
  COMPANY_RENAMED: 'LOGISTICS_COMPANY_RENAMED',
  COMPANY_ENABLED: 'LOGISTICS_COMPANY_ENABLED',
  COMPANY_DISABLED: 'LOGISTICS_COMPANY_DISABLED',
  MEMBER_INVITED: 'LOGISTICS_MEMBER_INVITED',
  INVITATION_CREATED: 'LOGISTICS_INVITATION_CREATED',
  INVITATION_WITHDRAWN: 'LOGISTICS_INVITATION_WITHDRAWN',
  MEMBER_ROLE_CHANGED: 'LOGISTICS_MEMBER_ROLE_CHANGED',
  MEMBER_REMOVED: 'LOGISTICS_MEMBER_REMOVED',
} as const;
export type LogisticsAuditAction = (typeof LOGISTICS_AUDIT)[keyof typeof LOGISTICS_AUDIT];

/**
 * Who is acting. STAFF is TrustOps behind `logistics.manage`; MEMBER is a company POC on the portal,
 * whose admin role is re-checked under the company lock before any change (`requireActingAdmin`).
 */
export interface LogisticsActor {
  kind: 'STAFF' | 'MEMBER';
  userId: string;
  sessionId?: string | undefined;
  /** Already checked with `net.isIP`: the audit column is `inet`. */
  ip?: string | null;
  userAgent?: string | null;
}

export const eventActorFor = (actor: LogisticsActor): EventActor => ({
  type: actor.kind === 'STAFF' ? 'STAFF' : 'LOGISTICS',
  id: actor.userId,
});

export const writeLogisticsAudit = (
  tx: Tx,
  actor: LogisticsActor,
  action: LogisticsAuditAction,
  input: { companyId: string; subjectUserId?: string | null; metadata?: Record<string, unknown> },
) =>
  writeAudit(tx, {
    action,
    outcome: 'SUCCESS',
    actorType: actor.kind === 'STAFF' ? 'STAFF' : 'USER',
    actorUserId: actor.userId,
    subjectUserId: input.subjectUserId ?? null,
    sessionId: actor.sessionId ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    metadata: { companyId: input.companyId, ...input.metadata },
  });
