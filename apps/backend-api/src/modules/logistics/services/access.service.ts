// What identity asks the logistics module about a person (m2 §2), through the two ports the registry
// wires in: is this account eligible for a LOGISTICS session, and — inside the very transaction that
// opens that session — accept their invitation, because login IS acceptance.
//
// And, for every LOGISTICS request, which company and role the caller holds right now. Never cached on
// the token: a removal or a role change takes effect on the caller's next request.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../../../db/errors.js';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { CompanyMembership } from '../../../platform/http/principal.js';
import { logisticsMemberActivated } from '../domain/events.js';
import { LIVE_MEMBER_STATUSES } from '../domain/membership.js';
import { logisticsCompanyMembers } from '../infrastructure/postgres/schema/index.js';

export interface AcceptedMembership extends CompanyMembership {
  memberId: string;
}

const membershipColumns = {
  memberId: logisticsCompanyMembers.id,
  companyId: logisticsCompanyMembers.companyId,
  role: logisticsCompanyMembers.role,
};

/** The principal's membership: the caller's one ACTIVE row, or null. */
export async function activeMembership(
  db: Pick<Db, 'select'>,
  userId: string,
): Promise<CompanyMembership | null> {
  const row = (
    await db
      .select({ companyId: logisticsCompanyMembers.companyId, role: logisticsCompanyMembers.role })
      .from(logisticsCompanyMembers)
      .where(and(eq(logisticsCompanyMembers.userId, userId), eq(logisticsCompanyMembers.status, 'ACTIVE')))
      .limit(1)
  )[0];
  return row ?? null;
}

/** May this account open a LOGISTICS session at all? An INVITED or ACTIVE membership anywhere. */
export async function hasLogisticsAccess(tx: Pick<Tx, 'select'>, userId: string): Promise<boolean> {
  const row = (
    await tx
      .select({ id: logisticsCompanyMembers.id })
      .from(logisticsCompanyMembers)
      .where(
        and(
          eq(logisticsCompanyMembers.userId, userId),
          inArray(logisticsCompanyMembers.status, [...LIVE_MEMBER_STATUSES]),
        ),
      )
      .limit(1)
  )[0];
  return row !== undefined;
}

export const alreadyHasActiveCompany = (): ApiError =>
  new ApiError(
    409,
    'ALREADY_HAS_ACTIVE_COMPANY',
    'Already with another company',
    'This account is already active with another logistics company.',
  );

/**
 * Login is acceptance (m2 §2). An ACTIVE membership is kept as it is; otherwise the newest INVITED one
 * becomes ACTIVE. Null when the account has neither, which the caller answers `403 NO_LOGISTICS_ACCESS`.
 *
 * Runs in the session's transaction, so a refused activation opens no session. Two first sign-ins
 * racing on two different invitations are settled by `active_user_uidx`, in Postgres: exactly one
 * row becomes ACTIVE and the loser answers `409 ALREADY_HAS_ACTIVE_COMPANY` (T-085). Signing in again
 * afterwards finds the winner's ACTIVE row and simply uses it.
 */
export async function acceptOnLogin(tx: Tx, userId: string): Promise<AcceptedMembership | null> {
  const readActive = async (): Promise<AcceptedMembership | null> =>
    (
      await tx
        .select(membershipColumns)
        .from(logisticsCompanyMembers)
        .where(and(eq(logisticsCompanyMembers.userId, userId), eq(logisticsCompanyMembers.status, 'ACTIVE')))
        .limit(1)
    )[0] ?? null;

  const active = await readActive();
  if (active) return active;

  const invited = (
    await tx
      .select(membershipColumns)
      .from(logisticsCompanyMembers)
      .where(and(eq(logisticsCompanyMembers.userId, userId), eq(logisticsCompanyMembers.status, 'INVITED')))
      .orderBy(desc(logisticsCompanyMembers.invitedAt))
      .limit(1)
      .for('update')
  )[0];
  // Nothing INVITED may mean a concurrent sign-in of the same person accepted it while this one waited
  // on the row lock: their row is ACTIVE now, and this sign-in uses it.
  if (!invited) return readActive();

  let accepted: boolean;
  try {
    accepted = await tx.transaction(async (sp) => {
      const rows = await sp
        .update(logisticsCompanyMembers)
        .set({ status: 'ACTIVE', acceptedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(logisticsCompanyMembers.id, invited.memberId),
            eq(logisticsCompanyMembers.status, 'INVITED'),
          ),
        )
        .returning({ id: logisticsCompanyMembers.id });
      return rows.length > 0;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'active_user_uidx')) throw alreadyHasActiveCompany();
    throw error;
  }
  if (!accepted) return readActive();

  await publish(tx, logisticsMemberActivated, {
    payload: { memberId: invited.memberId, companyId: invited.companyId, userId },
    aggregateType: 'logistics.company',
    aggregateId: invited.companyId,
    actor: { type: 'LOGISTICS', id: userId },
  });
  return invited;
}
