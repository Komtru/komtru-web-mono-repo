// The applicant's half (T-055): save a draft, submit it, read its status, resubmit after changes were
// requested. These back SO1 to SO5, BVR1 and the changes-requested state in T-121.
//
// Three rules carry most of the weight:
//  - At most one live application per person is the partial unique index's rule, not this file's. The
//    code reads first only so the common case gets a clear answer; a lost race is the index's 23505.
//  - Submit is refused without the CAC documents (422), and with any other required field or document
//    missing. A submitted application is therefore always a complete one: staff are never asked to
//    review a form that was never finished.
//  - Submitting registers a MERCHANT_APPLICATION case and starts the evidence collection. The CAC lookup
//    and the bank name-match are EVIDENCE for the reviewer; nothing here, or in the jobs it starts,
//    approves or rejects anything.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { registerCase } from '../../cases/index.js';
import { users } from '../../identity/index.js';
import { isValidRcNumber, normaliseRcNumber } from '../../trust/index.js';
import {
  DOCUMENT_LABELS,
  DOCUMENT_TYPES,
  cacDocumentsPresent,
  missingDocuments,
  missingFields,
  type ApplicationForm,
  type BusinessType,
  type ChangeItem,
  type DocumentType,
  type MissingDocument,
} from '../domain/application.js';
import { merchantApplicationSubmitted } from '../domain/events.js';
import { LIVE_STATUSES, type MerchantApplicationStatus } from '../domain/status.js';
import {
  merchantApplicationDocuments,
  merchantApplicationEvents,
  merchantApplications,
  type MerchantApplication,
} from '../infrastructure/postgres/schema/applications.js';
import { merchantProfiles } from '../infrastructure/postgres/schema/profiles.js';
import { factsFor, caseSubjectId, formOf } from './evidence.service.js';
import { logEvent } from './log.js';
import type { MerchantPorts } from './ports.js';

export interface ApplicationDeps {
  db: Db;
  ports: MerchantPorts;
  logger: Logger;
}

export interface DraftInput {
  businessName?: string;
  businessType?: BusinessType;
  addressLine?: string;
  stateId?: string;
  cityId?: string;
  categories?: string[];
  cacRcNumber?: string;
  payoutAccountId?: string;
  /** Each one replaces the document of that type. */
  documents?: { docType: DocumentType; fileId: string }[];
}

export interface ApplicantDocument {
  docType: DocumentType;
  label: string;
  fileId: string;
}

export interface ApplicantApplicationView {
  id: string;
  status: MerchantApplicationStatus;
  form: Partial<ApplicationForm>;
  documents: ApplicantDocument[];
  /** What staff asked to be changed. Empty unless the status is CHANGES_REQUESTED. */
  changesRequested: ChangeItem[];
  /** The last decision, in the words staff wrote for the applicant. Never the policy citation. */
  lastDecision: { outcome: string; reason: string; decidedAt: Date } | null;
  canEdit: boolean;
  submissionCount: number;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const EDITABLE: readonly MerchantApplicationStatus[] = ['DRAFT', 'CHANGES_REQUESTED'];

const validation = (title: string, fieldErrors: { path: string; message: string }[], detail?: string) =>
  new ApiError(422, 'VALIDATION_FAILED', title, detail, fieldErrors);

const notFound = () => new ApiError(404, 'NOT_FOUND', 'No such application');

// --- reads ------------------------------------------------------------------------------------------

const documentsOf = async (db: Pick<Db, 'select'>, applicationId: string): Promise<ApplicantDocument[]> => {
  const rows = await db
    .select()
    .from(merchantApplicationDocuments)
    .where(eq(merchantApplicationDocuments.applicationId, applicationId));
  return DOCUMENT_TYPES.flatMap((docType) => {
    const row = rows.find((candidate) => candidate.docType === docType);
    return row ? [{ docType, label: DOCUMENT_LABELS[docType], fileId: row.fileId }] : [];
  });
};

export async function toApplicantView(
  db: Pick<Db, 'select'>,
  app: MerchantApplication,
): Promise<ApplicantApplicationView> {
  // Sequential: `db` may be a transaction, a single connection (see evidence.service).
  const documents = await documentsOf(db, app.id);
  const [decision] = await db
    .select({
      toStatus: merchantApplicationEvents.toStatus,
      reason: merchantApplicationEvents.reason,
      createdAt: merchantApplicationEvents.createdAt,
    })
    .from(merchantApplicationEvents)
    .where(
      and(
        eq(merchantApplicationEvents.applicationId, app.id),
        eq(merchantApplicationEvents.actorType, 'STAFF'),
        inArray(merchantApplicationEvents.toStatus, ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
      ),
    )
    .orderBy(desc(merchantApplicationEvents.createdAt))
    .limit(1);
  return {
    id: app.id,
    status: app.status,
    form: formOf(app),
    documents,
    changesRequested: app.status === 'CHANGES_REQUESTED' ? app.changesRequested : [],
    lastDecision: decision?.reason
      ? { outcome: decision.toStatus, reason: decision.reason, decidedAt: decision.createdAt }
      : null,
    canEdit: EDITABLE.includes(app.status),
    submissionCount: app.submissionCount,
    submittedAt: app.submittedAt,
    decidedAt: app.decidedAt,
    createdAt: app.createdAt,
  };
}

/** Their live application if they have one, otherwise the most recent decided one. Null before the first. */
export async function getMyApplication(db: Db, userId: string): Promise<ApplicantApplicationView | null> {
  const [live] = await db
    .select()
    .from(merchantApplications)
    .where(
      and(eq(merchantApplications.userId, userId), inArray(merchantApplications.status, [...LIVE_STATUSES])),
    )
    .limit(1);
  const [latest] = live
    ? [live]
    : await db
        .select()
        .from(merchantApplications)
        .where(eq(merchantApplications.userId, userId))
        .orderBy(desc(merchantApplications.createdAt))
        .limit(1);
  return latest ? toApplicantView(db, latest) : null;
}

// --- eligibility and validation ---------------------------------------------------------------------

async function assertCanApply(db: Pick<Db, 'select'>, userId: string): Promise<void> {
  const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to apply');
  if (user.status !== 'ACTIVE') {
    throw new ApiError(403, 'FORBIDDEN', 'This account cannot apply right now');
  }
  const [profile] = await db
    .select({ status: merchantProfiles.certificationStatus })
    .from(merchantProfiles)
    .where(eq(merchantProfiles.userId, userId))
    .limit(1);
  if (profile?.status === 'CERTIFIED') {
    throw new ApiError(409, 'CONFLICT', 'You are already a certified merchant');
  }
  // Losing certification is not undone through the ordinary queue: a risk-suspended or revoked seller
  // would otherwise be one approval away from being re-certified by a reviewer who never saw why.
  if (profile) {
    throw new ApiError(
      409,
      'CONFLICT',
      'Your merchant certification was ended',
      'It cannot be applied for again here. Contact support.',
    );
  }
}

async function validateInput(deps: ApplicationDeps, userId: string, input: DraftInput): Promise<void> {
  const problems: { path: string; message: string }[] = [];
  const { ports } = deps;

  if (input.cacRcNumber !== undefined && !isValidRcNumber(normaliseRcNumber(input.cacRcNumber))) {
    problems.push({ path: 'cacRcNumber', message: 'must be a CAC registration number' });
  }
  if (input.categories !== undefined) {
    const known = new Set(await ports.categoryCodes());
    const unknown = input.categories.filter((code) => !known.has(code));
    if (unknown.length > 0)
      problems.push({ path: 'categories', message: `unknown categories: ${unknown.join(', ')}` });
  }
  if (input.stateId !== undefined && input.cityId !== undefined) {
    if (!(await ports.cityBelongsToState(input.stateId, input.cityId))) {
      problems.push({ path: 'cityId', message: 'must be a city in the chosen state' });
    }
  }
  if (input.payoutAccountId !== undefined) {
    const account = await ports.payoutAccountOf(userId, input.payoutAccountId);
    if (!account || account.status === 'DISABLED' || account.status === 'FAILED') {
      problems.push({ path: 'payoutAccountId', message: 'must be one of your own payout accounts' });
    }
  }
  for (const document of input.documents ?? []) {
    const file = await ports.findFile(document.fileId);
    // The same message for a stranger's file and a missing one: the form must not be a way to probe ids.
    if (
      !file ||
      file.uploaderUserId !== userId ||
      file.category !== 'KYC_DOCUMENT' ||
      file.status !== 'ACTIVE' ||
      file.uploadState === 'REJECTED'
    ) {
      problems.push({
        path: `documents.${document.docType}`,
        message: 'must be a KYC document you uploaded',
      });
    }
  }
  if (problems.length > 0) throw validation('Some details need fixing', problems);
}

// --- draft ------------------------------------------------------------------------------------------

const liveFor = async (tx: Tx, userId: string): Promise<MerchantApplication | undefined> =>
  (
    await tx
      .select()
      .from(merchantApplications)
      .where(
        and(
          eq(merchantApplications.userId, userId),
          inArray(merchantApplications.status, [...LIVE_STATUSES]),
        ),
      )
      .for('update')
      .limit(1)
  )[0];

/**
 * Creates the applicant's draft on first save, then updates it. Only fields present in the input change,
 * so a screen of the form saves its own fields without clobbering the others. Refused (409) once the
 * application is with staff: what they are reviewing must not move under them.
 */
export async function saveDraft(
  deps: ApplicationDeps,
  userId: string,
  input: DraftInput,
): Promise<ApplicantApplicationView> {
  await assertCanApply(deps.db, userId);
  await validateInput(deps, userId, input);

  return deps.db.transaction(async (tx) => {
    let app = await liveFor(tx, userId);
    if (!app) {
      const [created] = await tx
        .insert(merchantApplications)
        .values({ userId })
        // The partial unique index decides a race between two tabs; the loser reads the winner's row.
        .onConflictDoNothing()
        .returning();
      if (created) {
        await logEvent(tx, {
          applicationId: created.id,
          from: null,
          to: 'DRAFT',
          actorType: 'APPLICANT',
          actorUserId: userId,
        });
        app = created;
      } else {
        app = await liveFor(tx, userId);
      }
    }
    if (!app) throw new Error('merchant: a draft conflicted on creation and then vanished');
    if (!EDITABLE.includes(app.status)) {
      throw new ApiError(
        409,
        'CONFLICT',
        'This application is with our team',
        'It cannot be edited while it is being reviewed. If changes are needed we will ask for them.',
      );
    }

    const [updated] = await tx
      .update(merchantApplications)
      .set({
        ...(input.businessName === undefined ? {} : { businessName: input.businessName.trim() }),
        ...(input.businessType === undefined ? {} : { businessType: input.businessType }),
        ...(input.addressLine === undefined ? {} : { addressLine: input.addressLine.trim() }),
        ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
        ...(input.cityId === undefined ? {} : { cityId: input.cityId }),
        ...(input.categories === undefined ? {} : { categories: [...new Set(input.categories)] }),
        ...(input.cacRcNumber === undefined ? {} : { cacRcNumber: normaliseRcNumber(input.cacRcNumber) }),
        ...(input.payoutAccountId === undefined ? {} : { payoutAccountId: input.payoutAccountId }),
        updatedAt: new Date(),
      })
      .where(eq(merchantApplications.id, app.id))
      .returning();
    if (!updated) throw notFound();

    for (const document of input.documents ?? []) {
      // A replaced file is superseded: nobody should keep a grant on a document that is no longer the one.
      const [previous] = await tx
        .select({ fileId: merchantApplicationDocuments.fileId })
        .from(merchantApplicationDocuments)
        .where(
          and(
            eq(merchantApplicationDocuments.applicationId, app.id),
            eq(merchantApplicationDocuments.docType, document.docType),
          ),
        );
      if (previous && previous.fileId !== document.fileId) {
        await deps.ports.revokeReviewerAccess(previous.fileId, tx);
      }
      await tx
        .insert(merchantApplicationDocuments)
        .values({ applicationId: app.id, docType: document.docType, fileId: document.fileId })
        .onConflictDoUpdate({
          target: [merchantApplicationDocuments.applicationId, merchantApplicationDocuments.docType],
          set: { fileId: document.fileId, updatedAt: new Date() },
        });
    }
    return toApplicantView(tx, updated);
  });
}

// --- submit and resubmit ----------------------------------------------------------------------------

/** What a complete submission needs, as the field errors a 422 carries. */
const incompleteErrors = (
  form: Partial<ApplicationForm>,
  present: readonly DocumentType[],
): { path: string; message: string }[] => {
  const problems: { path: string; message: string }[] = missingFields(form).map((field) => ({
    path: field,
    message: 'is required',
  }));
  const documentPath: Record<MissingDocument, string> = {
    CAC_CERTIFICATE: 'documents.CAC_CERTIFICATE',
    STATUS_REPORT_OR_MEMORANDUM: 'documents.STATUS_REPORT',
    DIRECTOR_ID: 'documents.DIRECTOR_ID',
  };
  for (const missing of missingDocuments(present)) {
    problems.push({ path: documentPath[missing], message: 'is required' });
  }
  return problems;
};

export type SubmitMode = 'SUBMIT' | 'RESUBMIT';

export async function submitApplication(
  deps: ApplicationDeps,
  input: { userId: string; applicationId: string; mode: SubmitMode },
): Promise<ApplicantApplicationView> {
  const expected: MerchantApplicationStatus = input.mode === 'SUBMIT' ? 'DRAFT' : 'CHANGES_REQUESTED';

  const result = await deps.db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(merchantApplications)
      .where(
        and(eq(merchantApplications.id, input.applicationId), eq(merchantApplications.userId, input.userId)),
      )
      .for('update');
    if (!app) throw notFound();
    if (app.status !== expected) {
      throw new ApiError(
        409,
        'INVALID_TRANSITION',
        input.mode === 'SUBMIT'
          ? 'This application has already been submitted'
          : 'Nothing was asked to change',
        undefined,
        undefined,
        { status: app.status },
      );
    }

    const documents = await tx
      .select()
      .from(merchantApplicationDocuments)
      .where(eq(merchantApplicationDocuments.applicationId, app.id));
    const present = documents.map((document) => document.docType);
    const form = formOf(app);

    // The CAC pair is the one refusal the ticket names, so it gets its own title; the rest of what is
    // missing rides along in the same response so the form is fixed in one pass.
    const problems = incompleteErrors(form, present);
    if (problems.length > 0) {
      throw validation(
        cacDocumentsPresent(present) ? 'The application is not complete' : 'The CAC documents are required',
        problems,
        cacDocumentsPresent(present)
          ? undefined
          : 'Upload your CAC certificate and your status report or memorandum before you submit.',
      );
    }

    // Every document must be a finished upload by this applicant: staff cannot view half a file.
    const notReady: { path: string; message: string }[] = [];
    for (const document of documents) {
      const file = await deps.ports.findFile(document.fileId);
      if (
        !file ||
        file.uploaderUserId !== input.userId ||
        file.category !== 'KYC_DOCUMENT' ||
        file.status !== 'ACTIVE'
      ) {
        addDocumentProblem(notReady, document.docType, 'must be a KYC document you uploaded');
      } else if (file.uploadState !== 'READY') {
        addDocumentProblem(notReady, document.docType, 'has not finished uploading');
      }
    }
    if (notReady.length > 0) throw validation('A document is not ready', notReady);

    const submission = app.submissionCount + 1;
    const withNumber = { ...app, submissionCount: submission };
    const { facts } = await factsFor(tx, deps.ports, withNumber);
    const registered = await registerCase(tx, {
      type: 'MERCHANT_APPLICATION',
      subjectType: 'merchant_application',
      subjectId: caseSubjectId(app.id, submission),
      title: `Merchant application: ${app.businessName ?? 'unnamed business'}`,
      facts,
    });

    const [updated] = await tx
      .update(merchantApplications)
      .set({
        status: 'SUBMITTED',
        caseId: registered.case.id,
        submissionCount: submission,
        submittedAt: new Date(),
        decidedAt: null,
        changesRequested: [],
        updatedAt: new Date(),
      })
      .where(eq(merchantApplications.id, app.id))
      .returning();
    if (!updated) throw notFound();

    await logEvent(tx, {
      applicationId: app.id,
      from: app.status,
      to: 'SUBMITTED',
      actorType: 'APPLICANT',
      actorUserId: input.userId,
      detail: { submission },
    });
    await publish(tx, merchantApplicationSubmitted, {
      payload: { applicationId: app.id, userId: input.userId, caseId: registered.case.id, submission },
      aggregateType: 'merchant.application',
      aggregateId: app.id,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    return { app: updated, documents, view: await toApplicantView(tx, updated) };
  });

  // After the commit, and allowed to fail: the application IS submitted. The grants are idempotent and
  // are made again whenever staff open the detail; the job reschedules itself while the lookup is pending.
  for (const document of result.documents) {
    await deps.ports.grantReviewerAccess(document.fileId).catch((error: unknown) => {
      deps.logger.error(
        { err: error, applicationId: input.applicationId, fileId: document.fileId },
        'merchant: a reviewer grant could not be made at submit; it is made again when staff open the application',
      );
    });
  }
  await deps.ports
    .enqueueEvidence({ applicationId: input.applicationId, attempt: 0 })
    .catch((error: unknown) => {
      deps.logger.error(
        { err: error, applicationId: input.applicationId },
        'merchant: the evidence job could not be enqueued; staff still see the live evidence matrix',
      );
    });
  return result.view;
}

function addDocumentProblem(
  into: { path: string; message: string }[],
  docType: DocumentType,
  message: string,
): void {
  into.push({ path: `documents.${docType}`, message });
}
