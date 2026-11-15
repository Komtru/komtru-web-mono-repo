// The evidence matrix for one application (T-055): what staff sees beside the documents, and the handful
// of scalar facts the advisory reads. Everything here is a READ of someone else's record, taken live, so
// the matrix on screen is never older than the page. It attaches evidence and never decides.
import { eq } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { caseIndex, syncCaseFacts, type CaseFacts, type CaseSubject } from '../../cases/index.js';
import { VERIFICATION_LEVELS, users } from '../../identity/index.js';
import { normaliseRcNumber, readBusinessEvidence } from '../../trust/index.js';
import {
  DOCUMENT_TYPES,
  cacDocumentsPresent,
  missingDocuments,
  missingFields,
  type ApplicationForm,
  type DocumentType,
} from '../domain/application.js';
import { deriveFacts, type BankMatchState, type EvidenceMatrix } from '../domain/evidence.js';
import {
  merchantApplicationDocuments,
  type MerchantApplication,
} from '../infrastructure/postgres/schema/applications.js';
import type { MerchantPorts } from './ports.js';

export const CASE_SUBJECT_TYPE = 'merchant_application';

/**
 * A decided case is never reopened, so every submission is a case of its own: the first under the
 * application's id, a resubmission under `<id>:<n>`.
 */
export const caseSubjectId = (applicationId: string, submission: number): string =>
  submission <= 1 ? applicationId : `${applicationId}:${String(submission)}`;

export const caseSubjectFor = (app: Pick<MerchantApplication, 'id' | 'submissionCount'>): CaseSubject => ({
  type: 'MERCHANT_APPLICATION',
  subjectType: CASE_SUBJECT_TYPE,
  subjectId: caseSubjectId(app.id, app.submissionCount),
});

type Reader = Pick<Db, 'select'>;

export const formOf = (app: MerchantApplication): Partial<ApplicationForm> => ({
  ...(app.businessName === null ? {} : { businessName: app.businessName }),
  ...(app.businessType === null ? {} : { businessType: app.businessType }),
  ...(app.addressLine === null ? {} : { addressLine: app.addressLine }),
  ...(app.stateId === null ? {} : { stateId: app.stateId }),
  ...(app.cityId === null ? {} : { cityId: app.cityId }),
  categories: app.categories,
  ...(app.cacRcNumber === null ? {} : { cacRcNumber: app.cacRcNumber }),
  ...(app.payoutAccountId === null ? {} : { payoutAccountId: app.payoutAccountId }),
});

export async function documentTypesOf(db: Reader, applicationId: string): Promise<DocumentType[]> {
  const rows = await db
    .select({ docType: merchantApplicationDocuments.docType })
    .from(merchantApplicationDocuments)
    .where(eq(merchantApplicationDocuments.applicationId, applicationId));
  return rows.map((row) => row.docType);
}

const BANK_STATES: readonly BankMatchState[] = ['EXACT', 'FUZZY_MATCH', 'MISMATCH'];
const asBankState = (value: string | null): BankMatchState =>
  BANK_STATES.find((state) => state === value) ?? 'NOT_RUN';

export async function buildEvidence(
  db: Reader,
  ports: Pick<MerchantPorts, 'payoutAccountOf'>,
  app: MerchantApplication,
): Promise<EvidenceMatrix> {
  // One after another, not Promise.all: `db` may be a transaction, which is a single connection, and
  // two queries in flight on one connection is a deprecated, order-undefined use of the driver.
  const [user] = await db
    .select({ level: users.verificationLevel })
    .from(users)
    .where(eq(users.id, app.userId))
    .limit(1);
  const cac = await readBusinessEvidence(db, app.userId);
  const present = await documentTypesOf(db, app.id);
  const payout = app.payoutAccountId
    ? await ports.payoutAccountOf(app.userId, app.payoutAccountId)
    : undefined;
  const level = user ? VERIFICATION_LEVELS.indexOf(user.level) : 0;
  const applicationRc = app.cacRcNumber ? normaliseRcNumber(app.cacRcNumber) : null;

  return {
    identityLevel: Math.max(level, 0),
    cacLookup: {
      state: cac.state,
      registeredBusinessName: cac.registeredBusinessName,
      cacStatus: cac.cacStatus,
      officersMatch: cac.officersMatch,
      ...(cac.rcNumber === null || applicationRc === null
        ? {}
        : { rcMatchesApplication: cac.rcNumber === applicationRc }),
    },
    documents: {
      required: ['CAC_CERTIFICATE', 'STATUS_REPORT_OR_MEMORANDUM', 'DIRECTOR_ID'],
      present: [...present],
      missing: missingDocuments(present),
      complete: cacDocumentsPresent(present) && present.includes('DIRECTOR_ID'),
    },
    bankNameMatch: {
      state: asBankState(payout?.nameMatchResult ?? null),
      bankName: payout?.bankName ?? null,
      accountNumberMasked: payout?.accountNumberMasked ?? null,
      resolvedAccountName: payout?.accountName ?? null,
    },
  };
}

/** The facts for the advisory, computed from the live matrix and the form as it stands. */
export async function factsFor(
  db: Reader,
  ports: Pick<MerchantPorts, 'payoutAccountOf'>,
  app: MerchantApplication,
): Promise<{ matrix: EvidenceMatrix; facts: CaseFacts }> {
  const matrix = await buildEvidence(db, ports, app);
  const facts = deriveFacts(matrix, { formComplete: missingFields(formOf(app)).length === 0 });
  return { matrix, facts };
}

/**
 * Brings the case's advisory inputs up to date with the matrix, only when something changed: a sync
 * writes a trail row, and re-writing identical facts on every page view would bury the trail.
 */
export async function refreshCaseFacts(
  db: Db,
  ports: Pick<MerchantPorts, 'payoutAccountOf'>,
  app: MerchantApplication,
): Promise<{ matrix: EvidenceMatrix; facts: CaseFacts }> {
  const computed = await factsFor(db, ports, app);
  if (!app.caseId) return computed;
  const [row] = await db
    .select({ facts: caseIndex.facts, state: caseIndex.state })
    .from(caseIndex)
    .where(eq(caseIndex.id, app.caseId))
    .limit(1);
  if (!row || row.state === 'DECIDED' || row.state === 'CLOSED') return computed;
  const current = row.facts;
  const same = Object.entries(computed.facts).every(([key, value]) => current[key] === value);
  if (!same) await db.transaction((tx) => syncCaseFacts(tx, caseSubjectFor(app), computed.facts));
  return computed;
}

export { DOCUMENT_TYPES };
