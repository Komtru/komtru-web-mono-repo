// How a merchant application is written on screen. The platform gives codes and ids; these are the
// words a reviewer would use, and the evidence rows the matrix draws from the live evidence.
import type {
  MerchantApplicationStatus,
  MerchantApplicationDetail,
  MerchantChangeItem,
  MerchantFormField,
  MerchantDocumentType,
} from '@komtru/api-client';
import type { ChipTone, EvidenceRow } from '@komtru/ui-kit';
import { humanise } from '../cases/format';

export const STATUS_LABELS: Record<MerchantApplicationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting review',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Waiting on the applicant',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
export const statusLabel = (status: MerchantApplicationStatus): string => STATUS_LABELS[status];

export function statusTone(status: MerchantApplicationStatus): ChipTone {
  switch (status) {
    case 'APPROVED':
      return 'resolved';
    case 'REJECTED':
      return 'risk';
    case 'SUBMITTED':
    case 'IN_REVIEW':
      return 'awaiting';
    default:
      return 'verified';
  }
}

/** The documents and fields a reviewer can ask to be changed, in the order the form asks for them. */
export const DOCUMENT_CHOICES: readonly { key: MerchantDocumentType; label: string }[] = [
  { key: 'CAC_CERTIFICATE', label: 'CAC certificate' },
  { key: 'STATUS_REPORT', label: 'CAC status report' },
  { key: 'MEMORANDUM', label: 'Memorandum and articles' },
  { key: 'DIRECTOR_ID', label: 'Proprietor or director ID' },
];

export const FIELD_CHOICES: readonly { key: MerchantFormField; label: string }[] = [
  { key: 'businessName', label: 'Business name' },
  { key: 'businessType', label: 'Business type' },
  { key: 'addressLine', label: 'Registered address' },
  { key: 'stateId', label: 'State' },
  { key: 'cityId', label: 'City' },
  { key: 'categories', label: 'Categories' },
  { key: 'cacRcNumber', label: 'CAC registration number' },
  { key: 'payoutAccountId', label: 'Payout account' },
];

export const changeLabel = (item: Pick<MerchantChangeItem, 'kind' | 'key'>): string =>
  [...DOCUMENT_CHOICES, ...FIELD_CHOICES].find((choice) => choice.key === item.key)?.label ??
  humanise(item.key);

export const businessTypeLabel = (type: string | null): string =>
  type === 'REGISTERED_BUSINESS' ? 'Registered business' : type === 'INDIVIDUAL' ? 'Individual' : '—';

/** "TechEdge NG" before a name was ever typed would be a lie; an application can only be here with one. */
export const businessLabel = (name: string | null): string => name ?? 'Unnamed business';

const LEVELS: Record<string, string> = {
  UNVERIFIED: 'Not verified',
  CONTACT_VERIFIED: 'Contact verified',
  IDENTITY_VERIFIED: 'Identity verified',
  BUSINESS_VERIFIED: 'Business verified',
  ENHANCED: 'Enhanced due diligence',
};
export const levelLabel = (name: string, level: number): string =>
  `Level ${level} · ${LEVELS[name] ?? humanise(name)}`;

/**
 * The evidence matrix, as the four rows the ticket names. Each is something a person weighs: `pass` is
 * settled, `check` is present but unconfirmed, `gap` is missing. None of them approves or rejects.
 */
export function evidenceRows(evidence: MerchantApplicationDetail['evidence']): EvidenceRow[] {
  const { cacLookup, bankNameMatch, documents } = evidence;

  const cac: EvidenceRow = (() => {
    const name = cacLookup.registeredBusinessName ?? 'a registered business';
    switch (cacLookup.state) {
      case 'VERIFIED': {
        const parts = [
          `CAC record found for ${name}`,
          cacLookup.cacStatus ? `status ${cacLookup.cacStatus}` : null,
          cacLookup.officersMatch === true ? 'the applicant is a registered officer' : null,
          cacLookup.officersMatch === false ? 'the applicant is not a registered officer' : null,
          cacLookup.rcMatchesApplication === false ? 'the RC number differs from the application' : null,
        ].filter((part): part is string => part !== null);
        const clean = cacLookup.officersMatch !== false && cacLookup.rcMatchesApplication !== false;
        return { id: 'cac', label: 'CAC lookup', detail: parts.join(' · '), state: clean ? 'pass' : 'check' };
      }
      case 'PENDING':
        return { id: 'cac', label: 'CAC lookup', detail: 'The lookup is still running', state: 'check' };
      case 'MANUAL_REVIEW':
        return {
          id: 'cac',
          label: 'CAC lookup',
          detail: 'The lookup needs a person on the verification queue',
          state: 'check',
        };
      case 'FAILED':
        return {
          id: 'cac',
          label: 'CAC lookup',
          detail: 'The lookup did not verify the business',
          state: 'gap',
        };
      default:
        return {
          id: 'cac',
          label: 'CAC lookup',
          detail: 'Not run yet. It needs the applicant’s own identity check first',
          state: 'gap',
        };
    }
  })();

  const bank: EvidenceRow = (() => {
    const account = [bankNameMatch.bankName, bankNameMatch.accountNumberMasked]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(' ');
    switch (bankNameMatch.state) {
      case 'EXACT':
        return {
          id: 'bank',
          label: 'Bank name-match',
          detail: `${account || 'The payout account'} matches the registered business name`,
          state: 'pass',
        };
      case 'FUZZY_MATCH':
        return {
          id: 'bank',
          label: 'Bank name-match',
          detail: `${account || 'The payout account'} is close to the registered name${bankNameMatch.resolvedAccountName ? `: ${bankNameMatch.resolvedAccountName}` : ''}`,
          state: 'check',
        };
      case 'MISMATCH':
        return {
          id: 'bank',
          label: 'Bank name-match',
          detail: `${account || 'The payout account'} is in a different name${bankNameMatch.resolvedAccountName ? `: ${bankNameMatch.resolvedAccountName}` : ''}`,
          state: 'gap',
        };
      default:
        return {
          id: 'bank',
          label: 'Bank name-match',
          detail: `${account ? `${account}: ` : ''}no name-match on record yet`,
          state: 'gap',
        };
    }
  })();

  return [
    {
      id: 'identity',
      label: 'Applicant identity',
      detail:
        evidence.identityLevel >= 2
          ? `Identity verified (level ${evidence.identityLevel})`
          : `Verification level ${evidence.identityLevel}: identity not yet verified`,
      state: evidence.identityLevel >= 2 ? 'pass' : 'gap',
    },
    cac,
    {
      id: 'documents',
      label: 'Documents present',
      detail: documents.complete
        ? 'CAC certificate, status report or memorandum, and proprietor ID'
        : `Missing: ${documents.missing.map((key) => humanise(key)).join(', ')}`,
      state: documents.complete ? 'pass' : 'gap',
    },
    bank,
  ];
}

/** Waiting longer than a day is what the clock's colour says on the queue; the application's own age. */
export function submittedLabel(submittedAt: string | null, now: Date = new Date()): string {
  if (submittedAt === null) return '—';
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(submittedAt).getTime()) / 60_000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  return `${minutes}m`;
}
