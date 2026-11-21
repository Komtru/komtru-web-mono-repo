// Staff onboard, list and update logistics companies (m2 §5a), and see a company's roster for support.
// Every route that reaches here is STAFF with `logistics.manage`; the portal never does.
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { publish } from '../../../platform/events/publish.js';
import { normaliseCompanyName, type CompanyStatus } from '../domain/company.js';
import type { InviteContact } from '../domain/contact.js';
import { logisticsCompanyCreated, logisticsCompanyUpdated } from '../domain/events.js';
import type { MemberStatus } from '../domain/membership.js';
import { logisticsCompanies } from '../infrastructure/postgres/schema/index.js';
import { LOGISTICS_AUDIT, eventActorFor, writeLogisticsAudit, type LogisticsActor } from './audit.js';
import {
  inviteToCompany,
  lockCompany,
  notFound,
  type InviteOutcome,
  type LogisticsCrypto,
} from './member.service.js';
import {
  companyColumns,
  findCompany,
  memberWhere,
  readMembers,
  toCompanyView,
  type CompanyView,
  type MemberView,
} from './views.js';

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export type OnboardResult = InviteOutcome & { company: CompanyView };

/**
 * `POST /admin/logistics/companies`: the company and its first POC, an ADMIN, in one transaction. The
 * POC is linked if their address belongs to a verified account and pending otherwise — onboarding
 * never fails because the person has not signed up yet (m2 §2 REVISED).
 */
export async function onboardCompany(
  db: Db,
  crypto: LogisticsCrypto,
  input: { name: string; initialPoc: InviteContact; actor: LogisticsActor },
): Promise<OnboardResult> {
  return db.transaction(async (tx) => {
    const { actor } = input;
    const row = (
      await tx
        .insert(logisticsCompanies)
        .values({ name: normaliseCompanyName(input.name), createdByUserId: actor.userId })
        .returning(companyColumns)
    )[0];
    if (!row) throw new Error('logistics: a company insert returned no row');

    await publish(tx, logisticsCompanyCreated, {
      payload: { companyId: row.id, name: row.name, createdByUserId: actor.userId },
      aggregateType: 'logistics.company',
      aggregateId: row.id,
      actor: eventActorFor(actor),
    });
    await writeLogisticsAudit(tx, actor, LOGISTICS_AUDIT.COMPANY_ONBOARDED, {
      companyId: row.id,
      metadata: {
        name: row.name,
        initialPocChannel: input.initialPoc.channel,
        initialPoc: input.initialPoc.masked,
      },
    });

    const outcome = await inviteToCompany(tx, crypto, {
      companyId: row.id,
      role: 'ADMIN',
      contact: input.initialPoc,
      invitedByUserId: null,
      actor,
    });
    return { company: toCompanyView(row), ...outcome };
  });
}

export async function listCompanies(
  db: Pick<Db, 'select'>,
  input: { status?: CompanyStatus; page: number; limit: number },
): Promise<Page<CompanyView>> {
  const where = input.status ? eq(logisticsCompanies.status, input.status) : undefined;
  const rows = await db
    .select(companyColumns)
    .from(logisticsCompanies)
    .where(where)
    // Park first, as the ship step pins it (design §7.1), then by name.
    .orderBy(desc(logisticsCompanies.isDefault), asc(logisticsCompanies.name), asc(logisticsCompanies.id))
    .limit(input.limit)
    .offset((input.page - 1) * input.limit);
  const total = (await db.select({ n: count() }).from(logisticsCompanies).where(where))[0]?.n ?? 0;
  return { items: rows.map(toCompanyView), page: input.page, limit: input.limit, total };
}

export async function updateCompany(
  db: Db,
  input: { companyId: string; name?: string; status?: CompanyStatus; actor: LogisticsActor },
): Promise<CompanyView> {
  return db.transaction(async (tx) => {
    const before = await lockCompany(tx, input.companyId);
    const previousStatus = (
      await tx
        .select({ status: logisticsCompanies.status })
        .from(logisticsCompanies)
        .where(eq(logisticsCompanies.id, input.companyId))
    )[0]?.status;
    const row = (
      await tx
        .update(logisticsCompanies)
        .set({
          ...(input.name !== undefined ? { name: normaliseCompanyName(input.name) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(logisticsCompanies.id, input.companyId))
        .returning(companyColumns)
    )[0];
    if (!row) throw notFound('company');
    await publish(tx, logisticsCompanyUpdated, {
      payload: { companyId: row.id, name: row.name, status: row.status },
      aggregateType: 'logistics.company',
      aggregateId: row.id,
      actor: eventActorFor(input.actor),
    });
    if (row.name !== before.name) {
      await writeLogisticsAudit(tx, input.actor, LOGISTICS_AUDIT.COMPANY_RENAMED, {
        companyId: row.id,
        metadata: { from: before.name, to: row.name },
      });
    }
    if (row.status !== previousStatus) {
      await writeLogisticsAudit(
        tx,
        input.actor,
        row.status === 'ENABLED' ? LOGISTICS_AUDIT.COMPANY_ENABLED : LOGISTICS_AUDIT.COMPANY_DISABLED,
        { companyId: row.id, metadata: { from: previousStatus, to: row.status } },
      );
    }
    return toCompanyView(row);
  });
}

/** A company's roster, by status, for staff (`GET /admin/logistics/companies/:id/members`) and the portal. */
export async function listMembers(
  db: Pick<Db, 'select'>,
  input: { companyId: string; statuses?: readonly MemberStatus[]; page: number; limit: number },
): Promise<Page<MemberView>> {
  if (!(await findCompany(db, input.companyId))) throw notFound('company');
  const { items, total } = await readMembers(db, and(memberWhere(input.companyId, input.statuses)), input);
  return { items, page: input.page, limit: input.limit, total };
}
