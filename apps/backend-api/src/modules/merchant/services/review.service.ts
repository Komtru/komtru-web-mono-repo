// The staff half (T-055): the queue, one application in full, taking it, and the three decisions.
//
// There is no `merchant_review_queue` table: a submitted application is a `MERCHANT_APPLICATION` case in
// the universal index (T-107) and this file is the merchant-side view over those cases, the way trust's
// KYC queue is over its own. Every staff decision is ONE transaction holding the case decision (with its
// reason and policy citation, and identity's admin action log), the status change and its log row, the
// effect on the account, the case closing, and the outbox events. A decision that cannot be explained
// afterwards does not happen.
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import {
  adviseOnCase,
  caseCode,
  caseIndex,
  closeCaseForSubject,
  decideCase,
  takeCase,
  type Advisory,
  type CaseActor,
} from '../../cases/index.js';
import { VERIFICATION_LEVELS, users } from '../../identity/index.js';
import { TRADE_STATUSES, trades } from '../../trades/index.js';
import {
  DOCUMENT_LABELS,
  validateChangeItems,
  type ChangeItem,
  type DocumentType,
} from '../domain/application.js';
import type { EvidenceMatrix } from '../domain/evidence.js';
import { merchantApplicationDecided } from '../domain/events.js';
import { canTransition, type MerchantApplicationStatus } from '../domain/status.js';
import {
  merchantApplicationDocuments,
  merchantApplicationEvents,
  merchantApplications,
  type MerchantApplication,
} from '../infrastructure/postgres/schema/applications.js';
import { certifyApplication, type Certified } from './certification.service.js';
import { caseSubjectFor, formOf, refreshCaseFacts } from './evidence.service.js';
import { logEvent } from './log.js';
import type { MerchantPorts } from './ports.js';

export interface ReviewDeps {
  db: Db;
  ports: MerchantPorts;
  logger: Logger;
}

export interface StaffActor extends CaseActor {
  roles: readonly string[];
}

/** SUBMITTED and IN_REVIEW: the work still to do. CHANGES_REQUESTED is waiting on the applicant. */
export const AWAITING_REVIEW: readonly MerchantApplicationStatus[] = ['SUBMITTED', 'IN_REVIEW'];

export interface QueueItem {
  applicationId: string;
  caseId: string;
  caseNumber: string;
  caseState: string;
  priority: string;
  slaStartedAt: Date;
  slaDueAt: Date;
  ownerUserId: string | null;
  applicantUserId: string;
  applicantPublicId: string;
  businessName: string | null;
  businessType: string | null;
  categories: string[];
  status: MerchantApplicationStatus;
  submissionCount: number;
  submittedAt: Date | null;
}

const itemColumns = {
  applicationId: merchantApplications.id,
  caseId: caseIndex.id,
  caseNumber: caseIndex.caseNumber,
  caseState: caseIndex.state,
  priority: caseIndex.priority,
  slaStartedAt: caseIndex.slaStartedAt,
  slaDueAt: caseIndex.slaDueAt,
  ownerUserId: caseIndex.ownerUserId,
  applicantUserId: merchantApplications.userId,
  applicantPublicId: users.publicId,
  businessName: merchantApplications.businessName,
  businessType: merchantApplications.businessType,
  categories: merchantApplications.categories,
  status: merchantApplications.status,
  submissionCount: merchantApplications.submissionCount,
  submittedAt: merchantApplications.submittedAt,
};

const toItem = (row: Omit<QueueItem, 'caseNumber'> & { caseNumber: number }): QueueItem => ({
  ...row,
  caseNumber: caseCode(row.caseNumber),
});

const joined = (db: Pick<Db, 'select'>) =>
  db
    .select(itemColumns)
    .from(merchantApplications)
    .innerJoin(caseIndex, eq(caseIndex.id, merchantApplications.caseId))
    .innerJoin(users, eq(users.id, merchantApplications.userId));

export interface ListInput {
  status?: MerchantApplicationStatus | undefined;
  category?: string | undefined;
  /** `open` is what awaits a person; `all` adds decided applications and those waiting on the applicant. */
  show: 'open' | 'all';
  page: number;
  limit: number;
}

const filterOf = (input: Pick<ListInput, 'status' | 'category' | 'show'>) =>
  and(
    input.status
      ? eq(merchantApplications.status, input.status)
      : input.show === 'open'
        ? inArray(merchantApplications.status, [...AWAITING_REVIEW])
        : undefined,
    input.category ? sql`${input.category} = ANY(${merchantApplications.categories})` : undefined,
  );

/**
 * Sorted by SLA risk: the case whose clock runs out first comes first, and finished work sinks below
 * live work when a person asks for everything. Paged by number, with the total, as the KYC queue is.
 */
export async function listApplications(
  db: Db,
  input: ListInput,
): Promise<{ items: QueueItem[]; page: number; limit: number; total: number }> {
  const where = filterOf(input);
  const rows = await joined(db)
    .where(where)
    .orderBy(
      sql`CASE WHEN ${caseIndex.state} IN ('DECIDED', 'CLOSED') THEN 1 ELSE 0 END`,
      asc(caseIndex.slaDueAt),
      desc(caseIndex.caseNumber),
    )
    .limit(input.limit)
    .offset((input.page - 1) * input.limit);
  const [total] = await db
    .select({ n: count() })
    .from(merchantApplications)
    .innerJoin(caseIndex, eq(caseIndex.id, merchantApplications.caseId))
    .where(where);
  return { items: rows.map(toItem), page: input.page, limit: input.limit, total: total?.n ?? 0 };
}

/** The sidebar's number: applications a person has yet to decide. */
export async function countAwaitingReview(db: Db): Promise<{ awaitingReview: number }> {
  const [row] = await db
    .select({ n: count() })
    .from(merchantApplications)
    .where(inArray(merchantApplications.status, [...AWAITING_REVIEW]));
  return { awaitingReview: row?.n ?? 0 };
}

// --- one application in full ------------------------------------------------------------------------

export interface DetailDocument {
  docType: DocumentType;
  label: string;
  fileId: string;
  contentType: string | null;
  /** Null when the file cannot be served (removed, or refused). The reviewer sees that, not a broken link. */
  url: string | null;
  expiresAt: Date | null;
}

export interface HistoryEntry {
  fromStatus: MerchantApplicationStatus | null;
  toStatus: MerchantApplicationStatus;
  actorType: string;
  actorUserId: string | null;
  reason: string | null;
  policyCitation: string | null;
  requested: ChangeItem[];
  createdAt: Date;
}

export interface ApplicationDetail extends QueueItem {
  form: {
    businessName: string | null;
    businessType: string | null;
    addressLine: string | null;
    stateName: string | null;
    cityName: string | null;
    categories: string[];
    cacRcNumber: string | null;
  };
  documents: DetailDocument[];
  evidence: EvidenceMatrix;
  advisory: Advisory;
  applicant: {
    userId: string;
    publicId: string;
    username: string | null;
    verificationLevel: number;
    verificationLevelName: string;
    memberSince: Date;
    trades: { total: number; completed: number };
  };
  changesRequested: ChangeItem[];
  history: HistoryEntry[];
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'No such application');

async function findApplication(db: Pick<Db, 'select'>, applicationId: string): Promise<MerchantApplication> {
  const [app] = await db
    .select()
    .from(merchantApplications)
    .where(eq(merchantApplications.id, applicationId));
  if (!app) throw notFound();
  return app;
}

const COMPLETED_TRADE_STATUSES = TRADE_STATUSES.filter(
  (status) => status === 'COMPLETED' || status === 'SETTLED',
);

/**
 * Opening an application is an act on someone's KYC documents, so it goes through M20 for every one of
 * them: the access decision, the signed URL, and a `file_access_log` row per view. The reviewer grant is
 * re-asserted first (idempotent), because the one made at submit is best-effort.
 */
export async function getApplicationDetail(
  deps: ReviewDeps,
  input: { applicationId: string; viewer: StaffActor },
): Promise<ApplicationDetail> {
  const { db, ports } = deps;
  const app = await findApplication(db, input.applicationId);
  if (!app.caseId) throw notFound(); // a draft has no case and is not staff's to see

  const { matrix } = await refreshCaseFacts(db, ports, app);
  const [item] = await joined(db).where(eq(merchantApplications.id, app.id));
  if (!item) throw notFound();
  const advisory = await adviseOnCase(db, app.caseId);

  const docRows = await db
    .select()
    .from(merchantApplicationDocuments)
    .where(eq(merchantApplicationDocuments.applicationId, app.id));
  const documents: DetailDocument[] = [];
  for (const row of docRows) {
    await ports.grantReviewerAccess(row.fileId).catch((error: unknown) => {
      deps.logger.error({ err: error, fileId: row.fileId }, 'merchant: a reviewer grant could not be made');
    });
    const file = await ports.findFile(row.fileId);
    const signed = await ports
      .signDocument(row.fileId, { userId: input.viewer.userId, roles: input.viewer.roles })
      .catch(() => undefined);
    documents.push({
      docType: row.docType,
      label: DOCUMENT_LABELS[row.docType],
      fileId: row.fileId,
      contentType: signed?.contentType ?? file?.contentType ?? null,
      url: signed?.url ?? null,
      expiresAt: signed?.expiresAt ?? null,
    });
  }

  const location = app.cityId ? await ports.locationLabel(app.cityId) : undefined;
  const [user] = await db
    .select({ username: users.username, level: users.verificationLevel, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, app.userId));
  const party = sql`(${trades.buyerUserId} = ${app.userId} OR ${trades.sellerUserId} = ${app.userId})`;
  const [tradeTotal] = await db.select({ n: count() }).from(trades).where(party);
  const [tradeDone] = await db
    .select({ n: count() })
    .from(trades)
    .where(and(party, inArray(trades.status, COMPLETED_TRADE_STATUSES)));

  const events = await db
    .select()
    .from(merchantApplicationEvents)
    .where(eq(merchantApplicationEvents.applicationId, app.id))
    .orderBy(asc(merchantApplicationEvents.createdAt));
  const levelName = user?.level ?? 'UNVERIFIED';
  const form = formOf(app);

  return {
    ...toItem(item),
    form: {
      businessName: form.businessName ?? null,
      businessType: form.businessType ?? null,
      addressLine: form.addressLine ?? null,
      stateName: location?.stateName ?? null,
      cityName: location?.cityName ?? null,
      categories: app.categories,
      cacRcNumber: form.cacRcNumber ?? null,
    },
    documents,
    evidence: matrix,
    advisory,
    applicant: {
      userId: app.userId,
      publicId: item.applicantPublicId,
      username: user?.username ?? null,
      verificationLevel: Math.max(VERIFICATION_LEVELS.indexOf(levelName), 0),
      verificationLevelName: levelName,
      memberSince: user?.createdAt ?? app.createdAt,
      trades: { total: tradeTotal?.n ?? 0, completed: tradeDone?.n ?? 0 },
    },
    changesRequested: app.status === 'CHANGES_REQUESTED' ? app.changesRequested : [],
    history: events.map((event) => ({
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorType: event.actorType,
      actorUserId: event.actorUserId,
      reason: event.reason,
      policyCitation: event.policyCitation,
      requested: (event.detail as { requested?: ChangeItem[] } | null)?.requested ?? [],
      createdAt: event.createdAt,
    })),
  };
}

// --- taking it --------------------------------------------------------------------------------------

/** Takes the case; the application moves to IN_REVIEW. Whoever takes it is the only one who can decide it. */
export async function assignApplication(
  db: Db,
  input: { actor: CaseActor; applicationId: string },
): Promise<{ applicationId: string; status: MerchantApplicationStatus; ownerUserId: string | null }> {
  const app = await findApplication(db, input.applicationId);
  if (!app.caseId || !AWAITING_REVIEW.includes(app.status)) {
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      'This application is not waiting for review',
      undefined,
      undefined,
      {
        status: app.status,
      },
    );
  }
  const taken = await takeCase(db, { actor: input.actor, caseId: app.caseId });
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(merchantApplications)
      .where(eq(merchantApplications.id, app.id))
      .for('update');
    if (locked?.status !== 'SUBMITTED') return; // already IN_REVIEW, or decided meanwhile
    await tx
      .update(merchantApplications)
      .set({ status: 'IN_REVIEW', updatedAt: new Date() })
      .where(eq(merchantApplications.id, app.id));
    await logEvent(tx, {
      applicationId: app.id,
      from: 'SUBMITTED',
      to: 'IN_REVIEW',
      actorType: 'STAFF',
      actorUserId: input.actor.userId,
    });
  });
  return { applicationId: app.id, status: 'IN_REVIEW', ownerUserId: taken.ownerUserId };
}

// --- deciding ---------------------------------------------------------------------------------------

export type Decision =
  { outcome: 'APPROVE' } | { outcome: 'REQUEST_CHANGES'; requested: ChangeItem[] } | { outcome: 'REJECT' };

export interface DecideInput {
  actor: CaseActor;
  applicationId: string;
  decision: Decision;
  reason: string;
  /** Required, and recorded with the decision and in the admin action log. */
  policyCitation: string;
}

export interface DecideResult {
  applicationId: string;
  status: MerchantApplicationStatus;
  storefrontSlug?: string;
}

const STATUS_OF = {
  APPROVE: 'APPROVED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
  REJECT: 'REJECTED',
} as const satisfies Record<Decision['outcome'], MerchantApplicationStatus>;

export async function decideApplication(db: Db, input: DecideInput): Promise<DecideResult> {
  const reason = input.reason.trim();
  const policyCitation = input.policyCitation.trim();
  if (reason.length === 0 || policyCitation.length === 0) {
    // The routes already refuse this; the service refuses it too, because the table's CHECK is the last
    // line and a thrown constraint is a 500 where this is a 422 the reviewer can act on.
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'A decision needs a reason and a policy citation',
      undefined,
      [
        ...(reason.length === 0 ? [{ path: 'reason', message: 'Required' }] : []),
        ...(policyCitation.length === 0 ? [{ path: 'policyCitation', message: 'Required' }] : []),
      ],
    );
  }
  if (input.decision.outcome === 'REQUEST_CHANGES') {
    const valid = validateChangeItems(input.decision.requested);
    if (!valid.ok) {
      throw new ApiError(422, 'VALIDATION_FAILED', valid.reason, undefined, [
        { path: 'requested', message: valid.reason },
      ]);
    }
  }
  const to = STATUS_OF[input.decision.outcome];

  return db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(merchantApplications)
      .where(eq(merchantApplications.id, input.applicationId))
      .for('update');
    if (!app) throw notFound();
    if (!app.caseId || !canTransition(app.status, to)) {
      throw new ApiError(
        409,
        'INVALID_TRANSITION',
        'This application is not waiting for a decision',
        `It is ${app.status.toLowerCase().replace('_', ' ')}.`,
        undefined,
        { status: app.status },
      );
    }

    // The case decision first: it needs the actor to own the case, and it writes the decision row, the
    // trust trail and identity's admin action log, each carrying the reason and the citation.
    await decideCase(tx, {
      actor: input.actor,
      caseId: app.caseId,
      outcome: to,
      reason,
      policyCitation,
    });

    let certified: Certified | undefined;
    if (input.decision.outcome === 'APPROVE') {
      certified = await certifyApplication(tx, {
        application: app,
        actorUserId: input.actor.userId,
        reason,
      });
    }
    const requested = input.decision.outcome === 'REQUEST_CHANGES' ? input.decision.requested : [];

    await tx
      .update(merchantApplications)
      .set({
        status: to,
        decidedAt: new Date(),
        changesRequested: requested,
        updatedAt: new Date(),
      })
      .where(eq(merchantApplications.id, app.id));
    await logEvent(tx, {
      applicationId: app.id,
      from: app.status,
      to,
      actorType: 'STAFF',
      actorUserId: input.actor.userId,
      reason,
      policyCitation,
      requested,
      ...(certified ? { detail: { storefrontSlug: certified.storefrontSlug } } : {}),
    });
    await closeCaseForSubject(tx, caseSubjectFor(app), to);
    await publish(tx, merchantApplicationDecided, {
      payload: {
        applicationId: app.id,
        userId: app.userId,
        outcome: to,
        status: to,
        reason,
        requested: requested.map(({ kind, key }) => ({ kind, key })),
        decidedByUserId: input.actor.userId,
      },
      aggregateType: 'merchant.application',
      aggregateId: app.id,
      actor: { type: 'STAFF', id: input.actor.userId },
    });
    return {
      applicationId: app.id,
      status: to,
      ...(certified ? { storefrontSlug: certified.storefrontSlug } : {}),
    };
  });
}
