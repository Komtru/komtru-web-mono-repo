// How a company, a member and an invitation are shown, and the reads that build them. A member is shown
// by name and a MASKED contact only: a company admin sees enough to recognise a colleague and nothing
// that would let them harvest a Komtru account's address.
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../../platform/events/publish.js';
import { maskEmail, maskPhone } from '../../../platform/identifiers.js';
import { userEmails, userPhones, userProfiles, users } from '../../identity/index.js';
import type { CompanyStatus } from '../domain/company.js';
import type { InvitationChannel } from '../domain/contact.js';
import type { MemberRole, MemberStatus } from '../domain/membership.js';
import {
  logisticsCompanies,
  logisticsCompanyMembers,
  logisticsMemberInvitations,
  type InvitationStatus,
} from '../infrastructure/postgres/schema/index.js';

/** Reads run inside a transaction or straight on the pool; both expose `select`. */
export type Reader = Pick<Tx, 'select'>;

export interface CompanyView {
  id: string;
  name: string;
  status: CompanyStatus;
  isDefault: boolean;
  createdAt: string;
}

export interface MemberView {
  id: string;
  name: string | null;
  contactMasked: string | null;
  role: MemberRole;
  status: MemberStatus;
  invitedAt: string;
  acceptedAt: string | null;
  removedAt: string | null;
}

export interface InvitationView {
  id: string;
  role: MemberRole;
  channel: InvitationChannel;
  contactMasked: string;
  /** `EXPIRED` is reported for a pending row past its expiry, whether or not a sweep has run. */
  status: InvitationStatus;
  invitedAt: string;
  expiresAt: string;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export const companyColumns = {
  id: logisticsCompanies.id,
  name: logisticsCompanies.name,
  status: logisticsCompanies.status,
  isDefault: logisticsCompanies.isDefault,
  createdAt: logisticsCompanies.createdAt,
};

export const toCompanyView = (row: {
  id: string;
  name: string;
  status: CompanyStatus;
  isDefault: boolean;
  createdAt: Date;
}): CompanyView => ({ ...row, createdAt: row.createdAt.toISOString() });

export async function findCompany(tx: Reader, companyId: string): Promise<CompanyView | null> {
  const row = (
    await tx.select(companyColumns).from(logisticsCompanies).where(eq(logisticsCompanies.id, companyId))
  )[0];
  return row ? toCompanyView(row) : null;
}

/**
 * Members with what the roster shows of each person. The joins are left joins on identity's own
 * tables, read through its barrel: a profile or a primary contact the person never set is a null,
 * never a missing member.
 */
export async function readMembers(
  tx: Reader,
  where: SQL | undefined,
  { page, limit }: { page: number; limit: number },
): Promise<{ items: MemberView[]; total: number }> {
  const rows = await tx
    .select({
      id: logisticsCompanyMembers.id,
      role: logisticsCompanyMembers.role,
      status: logisticsCompanyMembers.status,
      invitedAt: logisticsCompanyMembers.invitedAt,
      acceptedAt: logisticsCompanyMembers.acceptedAt,
      removedAt: logisticsCompanyMembers.removedAt,
      displayName: userProfiles.displayName,
      firstName: userProfiles.firstName,
      lastName: userProfiles.lastName,
      email: userEmails.email,
      phone: userPhones.phoneE164,
    })
    .from(logisticsCompanyMembers)
    .innerJoin(users, eq(users.id, logisticsCompanyMembers.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .leftJoin(userEmails, eq(userEmails.id, users.primaryEmailId))
    .leftJoin(userPhones, eq(userPhones.id, users.primaryPhoneId))
    .where(where)
    .orderBy(
      // Live rows first, admins before operators, then the newest invitation.
      sql`CASE ${logisticsCompanyMembers.status} WHEN 'ACTIVE' THEN 0 WHEN 'INVITED' THEN 1 ELSE 2 END`,
      logisticsCompanyMembers.role,
      desc(logisticsCompanyMembers.invitedAt),
    )
    .limit(limit)
    .offset((page - 1) * limit);

  const total = (await tx.select({ n: count() }).from(logisticsCompanyMembers).where(where))[0]?.n ?? 0;

  return {
    total,
    items: rows.map((row) => {
      const named = [row.firstName, row.lastName].filter(Boolean).join(' ');
      return {
        id: row.id,
        // No name until they have signed in and accepted. A LINKED invite resolves an address to an
        // account, and returning that account's name would make the invite form a lookup tool for
        // every partner admin; the masked contact is all the inviter typed in the first place.
        name: row.status === 'INVITED' ? null : (row.displayName ?? (named.length > 0 ? named : null)),
        contactMasked: row.email ? maskEmail(row.email) : row.phone ? maskPhone(row.phone) : null,
        role: row.role,
        status: row.status,
        invitedAt: row.invitedAt.toISOString(),
        acceptedAt: iso(row.acceptedAt),
        removedAt: iso(row.removedAt),
      };
    }),
  };
}

export const memberWhere = (companyId: string, statuses?: readonly MemberStatus[]): SQL | undefined =>
  and(
    eq(logisticsCompanyMembers.companyId, companyId),
    statuses && statuses.length > 0 ? inArray(logisticsCompanyMembers.status, [...statuses]) : undefined,
  );

export async function readMember(
  tx: Reader,
  companyId: string,
  memberId: string,
): Promise<MemberView | null> {
  const { items } = await readMembers(
    tx,
    and(eq(logisticsCompanyMembers.companyId, companyId), eq(logisticsCompanyMembers.id, memberId)),
    { page: 1, limit: 1 },
  );
  return items[0] ?? null;
}

export const toInvitationView = (
  row: {
    id: string;
    role: MemberRole;
    channel: InvitationChannel;
    destinationMasked: string;
    status: InvitationStatus;
    createdAt: Date;
    expiresAt: Date;
  },
  now = new Date(),
): InvitationView => ({
  id: row.id,
  role: row.role,
  channel: row.channel,
  contactMasked: row.destinationMasked,
  status: row.status === 'PENDING' && row.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : row.status,
  invitedAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

export const invitationColumns = {
  id: logisticsMemberInvitations.id,
  role: logisticsMemberInvitations.role,
  channel: logisticsMemberInvitations.channel,
  destinationMasked: logisticsMemberInvitations.destinationMasked,
  status: logisticsMemberInvitations.status,
  createdAt: logisticsMemberInvitations.createdAt,
  expiresAt: logisticsMemberInvitations.expiresAt,
};
