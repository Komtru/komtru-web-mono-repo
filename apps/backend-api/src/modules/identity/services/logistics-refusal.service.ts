// T-086: the audit trace of a logistics sign-in refused after the credentials were proved. Its own
// file so the password step and the second-factor step share it without importing each other.
import type { Tx } from '../../../platform/events/publish.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';

/**
 * T-086. A logistics sign-in refused for want of a membership, AFTER the credentials were proved. An
 * audit row under its own action and reason, and deliberately no `identity.login.failed` event and no
 * lockout charge: the person got their password right, and Risk's failure counts must not grow
 * because a courier's admin has not added them yet. `stage` says which check refused.
 */
export async function recordLogisticsRefusal(
  tx: Tx,
  input: { ip: string | null; userAgent: string | null },
  userId: string,
  stage: 'password' | 'accept' | 'mfa',
): Promise<void> {
  await writeAudit(tx, {
    action: AUDIT_ACTIONS.LOGIN_REFUSED,
    outcome: 'FAILURE',
    actorType: 'USER',
    actorUserId: userId,
    subjectUserId: userId,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { scope: 'LOGISTICS', reason: 'no_logistics_access', stage },
  });
}
