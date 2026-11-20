// Pending invitations (m2 §2 REVISED): listed, cancelled, and materialised into a membership when the
// invitee proves the address through identity's ordinary signup or contact verification.
//
// Materialisation runs inside the event subscriber's own transaction (the bus claims the event in
// it), so a redelivered `identity.email.verified` finds the invitation already ACCEPTED and does
// nothing. The new member sits at INVITED like every other: login is still what makes them ACTIVE.
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../../../db/errors.js';
import type { Db } from '../../../db/index.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { EventActor } from '@komtru/shared-types';
import { invitationDestinationHash, type InvitationChannel } from '../domain/contact.js';
import { logisticsInvitationCancelled, logisticsMemberInvited } from '../domain/events.js';
import {
  logisticsCompanies,
  logisticsCompanyMembers,
  logisticsMemberInvitations,
  type InvitationStatus,
} from '../infrastructure/postgres/schema/index.js';
import { notFound } from './member.service.js';
import { invitationColumns, toInvitationView, type InvitationView } from './views.js';

export async function listInvitations(
  db: Pick<Db, 'select'>,
  input: { companyId: string; status?: InvitationStatus; page: number; limit: number },
): Promise<{ items: InvitationView[]; page: number; limit: number; total: number }> {
  const where = and(
    eq(logisticsMemberInvitations.companyId, input.companyId),
    input.status === 'EXPIRED'
      ? sql`(${logisticsMemberInvitations.status} = 'EXPIRED' OR (${logisticsMemberInvitations.status} = 'PENDING' AND ${logisticsMemberInvitations.expiresAt} <= now()))`
      : input.status === 'PENDING'
        ? and(
            eq(logisticsMemberInvitations.status, 'PENDING'),
            gt(logisticsMemberInvitations.expiresAt, sql`now()`),
          )
        : input.status
          ? eq(logisticsMemberInvitations.status, input.status)
          : undefined,
  );
  const rows = await db
    .select(invitationColumns)
    .from(logisticsMemberInvitations)
    .where(where)
    .orderBy(desc(logisticsMemberInvitations.createdAt))
    .limit(input.limit)
    .offset((input.page - 1) * input.limit);
  const total =
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(logisticsMemberInvitations)
        .where(where)
    )[0]?.n ?? 0;
  const now = new Date();
  return {
    items: rows.map((row) => toInvitationView(row, now)),
    page: input.page,
    limit: input.limit,
    total,
  };
}

export async function cancelInvitation(
  tx: Tx,
  input: { companyId: string; invitationId: string; actorUserId: string; actor: EventActor },
): Promise<InvitationView> {
  const row = (
    await tx
      .update(logisticsMemberInvitations)
      .set({ status: 'CANCELLED', cancelledAt: sql`now()`, cancelledByUserId: input.actorUserId })
      .where(
        and(
          eq(logisticsMemberInvitations.id, input.invitationId),
          eq(logisticsMemberInvitations.companyId, input.companyId),
          eq(logisticsMemberInvitations.status, 'PENDING'),
        ),
      )
      .returning(invitationColumns)
  )[0];
  // Another company's invitation, an accepted one and one that never existed answer alike.
  if (!row) throw notFound('pending invitation');
  await publish(tx, logisticsInvitationCancelled, {
    payload: { invitationId: row.id, companyId: input.companyId },
    aggregateType: 'logistics.company',
    aggregateId: input.companyId,
    actor: input.actor,
  });
  return toInvitationView(row);
}

/**
 * Every live pending invitation filed under this proven address becomes an INVITED membership of the
 * person who proved it. Returns how many did. An invitation whose company already has this person
 * live is accepted against that existing row instead of failing the subscriber.
 */
export async function materialiseInvitations(
  tx: Tx,
  hasher: HmacHasher,
  input: { userId: string; channel: InvitationChannel; canonical: string },
): Promise<number> {
  const destinationHash = invitationDestinationHash(hasher, input.channel, input.canonical);
  const pending = await tx
    .select({
      id: logisticsMemberInvitations.id,
      companyId: logisticsMemberInvitations.companyId,
      companyName: logisticsCompanies.name,
      role: logisticsMemberInvitations.role,
      invitedByUserId: logisticsMemberInvitations.invitedByUserId,
    })
    .from(logisticsMemberInvitations)
    .innerJoin(logisticsCompanies, eq(logisticsCompanies.id, logisticsMemberInvitations.companyId))
    .where(
      and(
        eq(logisticsMemberInvitations.destinationHash, destinationHash),
        eq(logisticsMemberInvitations.channel, input.channel),
        eq(logisticsMemberInvitations.status, 'PENDING'),
        gt(logisticsMemberInvitations.expiresAt, sql`now()`),
      ),
    )
    .for('update', { of: logisticsMemberInvitations });

  let materialised = 0;
  for (const invitation of pending) {
    let memberId: string | undefined;
    let created = false;
    try {
      memberId = await tx.transaction(async (sp) => {
        const row = (
          await sp
            .insert(logisticsCompanyMembers)
            .values({
              companyId: invitation.companyId,
              userId: input.userId,
              role: invitation.role,
              status: 'INVITED',
              invitedByUserId: invitation.invitedByUserId,
            })
            .returning({ id: logisticsCompanyMembers.id })
        )[0];
        return row?.id;
      });
      created = memberId !== undefined;
    } catch (error) {
      if (!isUniqueViolation(error, 'company_user_live_uidx')) throw error;
      memberId = (
        await tx
          .select({ id: logisticsCompanyMembers.id })
          .from(logisticsCompanyMembers)
          .where(
            and(
              eq(logisticsCompanyMembers.companyId, invitation.companyId),
              eq(logisticsCompanyMembers.userId, input.userId),
              sql`${logisticsCompanyMembers.status} IN ('INVITED', 'ACTIVE')`,
            ),
          )
      )[0]?.id;
    }

    await tx
      .update(logisticsMemberInvitations)
      .set({
        status: 'ACCEPTED',
        memberId: memberId ?? null,
        acceptedByUserId: input.userId,
        acceptedAt: sql`now()`,
      })
      .where(eq(logisticsMemberInvitations.id, invitation.id));

    if (created && memberId) {
      materialised += 1;
      await publish(tx, logisticsMemberInvited, {
        payload: {
          memberId,
          companyId: invitation.companyId,
          companyName: invitation.companyName,
          userId: input.userId,
          role: invitation.role,
          via: 'INVITATION',
        },
        aggregateType: 'logistics.company',
        aggregateId: invitation.companyId,
        actor: { type: 'SYSTEM' },
      });
    }
  }
  return materialised;
}
