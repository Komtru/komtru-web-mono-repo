import type {
  MerchantApplication,
  MerchantChangeItem,
  MerchantDocumentType,
  MerchantFormField,
} from '@komtru/api-client';

// What the seller onboarding screens decide, as data: which screen a person sees for their application, which
// step holds each field, and what a step saves. No React here, so the rules are tested without a DOM.
//
// The applicant's form is the backend's. Submit refuses (422) without every field and the three documents below,
// so the steps collect all of them, including the ones the reference's five screens do not draw (see the plan).

export const SELL_STEPS = ['start', 'category', 'verify-business', 'payout'] as const;
export type SellStep = (typeof SELL_STEPS)[number];

/**
 * Merchant verification lives under the account's Verification section: the tab (M2/BVR1) is the entry point, and
 * the flow's steps and the approved screen (SO5) are reached from it. Every account is a seller already; these
 * screens are how a business gains merchant status.
 */
export const ACCOUNT_VERIFICATION_HREF = '/account/verification';
export const VERIFICATION_HREF = '/account/verification/merchant';

export const STEP_HREF: Record<SellStep, string> = {
  start: `${VERIFICATION_HREF}/start`,
  category: `${VERIFICATION_HREF}/category`,
  'verify-business': `${VERIFICATION_HREF}/verify-business`,
  payout: `${VERIFICATION_HREF}/payout`,
};

export const LIVE_HREF = `${VERIFICATION_HREF}/verified`;
/** Where a new merchant goes next: Start Trade, already on the selling side. There is no shop (2026-11-20). */
export const START_SELLING_HREF = '/trade/new?side=sell';

/** Where the person stands, read from the application. `null` is someone who has not started one. */
export type ApplicationPhase =
  'NOT_STARTED' | 'DRAFTING' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED';

export function phaseOf(application: MerchantApplication | null): ApplicationPhase {
  if (application === null) return 'NOT_STARTED';
  switch (application.status) {
    case 'DRAFT':
      return 'DRAFTING';
    case 'SUBMITTED':
    case 'IN_REVIEW':
      return 'IN_REVIEW';
    case 'CHANGES_REQUESTED':
      return 'CHANGES_REQUESTED';
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
  }
}

/** The three documents a complete submission needs (the backend's `missingDocuments`). */
export const REQUIRED_DOCUMENTS: readonly MerchantDocumentType[] = [
  'CAC_CERTIFICATE',
  'STATUS_REPORT',
  'DIRECTOR_ID',
];

/** A field the step saves, in the backend's key names. */
export type SellField = MerchantFormField;

/** The field of the form each step holds, and the documents it collects. */
export const STEP_FIELDS: Record<SellStep, readonly SellField[]> = {
  start: ['businessName', 'addressLine', 'stateId', 'cityId'],
  category: ['categories'],
  'verify-business': ['businessType', 'cacRcNumber'],
  payout: ['payoutAccountId'],
};

/** Which step a requested change sends the person to. */
export function stepForChange(item: Pick<MerchantChangeItem, 'kind' | 'key'>): SellStep {
  if (item.kind === 'DOCUMENT') return 'verify-business';
  return (
    (Object.keys(STEP_FIELDS) as SellStep[]).find((step) =>
      STEP_FIELDS[step].includes(item.key as SellField),
    ) ?? 'start'
  );
}

export const FIELD_LABEL: Record<SellField, string> = {
  businessName: 'Business name',
  businessType: 'Business type',
  addressLine: 'Registered address',
  stateId: 'State',
  cityId: 'City',
  categories: 'Categories',
  cacRcNumber: 'CAC registration number',
  payoutAccountId: 'Payout account',
};

export const DOCUMENT_LABEL: Record<MerchantDocumentType, string> = {
  CAC_CERTIFICATE: 'CAC certificate',
  STATUS_REPORT: 'CAC status report or memorandum',
  MEMORANDUM: 'Memorandum and articles',
  DIRECTOR_ID: 'Proprietor or director ID',
};

/** What a requested change is called to the person. An unknown key is shown as it came. */
export function changeLabel(item: Pick<MerchantChangeItem, 'kind' | 'key'>): string {
  if (item.kind === 'DOCUMENT') {
    return DOCUMENT_LABEL[item.key as MerchantDocumentType] ?? item.key;
  }
  return FIELD_LABEL[item.key as SellField] ?? item.key;
}

/** The values a seller has typed or chosen across the four steps, before they are saved. */
export interface SellValues {
  businessName: string;
  addressLine: string;
  stateId: string;
  cityId: string;
  categories: string[];
  cacRcNumber: string;
  payoutAccountId: string;
}

export const EMPTY_VALUES: SellValues = {
  businessName: '',
  addressLine: '',
  stateId: '',
  cityId: '',
  categories: [],
  cacRcNumber: '',
  payoutAccountId: '',
};

/** The values an application already holds, so a person who comes back sees what they entered. */
export function valuesFrom(application: MerchantApplication | null): SellValues {
  const form = application?.form;
  return {
    businessName: form?.businessName ?? '',
    addressLine: form?.addressLine ?? '',
    stateId: form?.stateId ?? '',
    cityId: form?.cityId ?? '',
    categories: form?.categories ?? [],
    cacRcNumber: form?.cacRcNumber ?? '',
    payoutAccountId: form?.payoutAccountId ?? '',
  };
}

/** Whether the person has attached a document of this type. */
export function hasDocument(application: MerchantApplication | null, docType: MerchantDocumentType): boolean {
  return application?.documents.some((document) => document.docType === docType) ?? false;
}

/** The document ids to send with a save: the ones already attached, with one type replaced or added. */
export function documentsWith(
  application: MerchantApplication | null,
  docType: MerchantDocumentType,
  fileId: string | null,
): { docType: MerchantDocumentType; fileId: string }[] {
  const kept = (application?.documents ?? [])
    .filter((document) => document.docType !== docType)
    .map((document) => ({ docType: document.docType, fileId: document.fileId }));
  return fileId === null ? kept : [...kept, { docType, fileId }];
}

/** The body a step sends. Only the fields the step owns, so one step never overwrites another's answers. */
export function stepBody(
  step: SellStep,
  values: SellValues,
): Partial<SellValues> & { businessType?: 'REGISTERED_BUSINESS' } {
  switch (step) {
    case 'start':
      return {
        businessName: values.businessName.trim(),
        addressLine: values.addressLine.trim(),
        stateId: values.stateId,
        cityId: values.cityId,
      };
    case 'category':
      return { categories: values.categories };
    case 'verify-business':
      // A merchant application is a registered business: the CAC number is required, so the type is too.
      return { businessType: 'REGISTERED_BUSINESS', cacRcNumber: values.cacRcNumber.trim() };
    case 'payout':
      return { payoutAccountId: values.payoutAccountId };
  }
}

/** Whether SO1 can be saved and carried on. */
export function startComplete(values: SellValues): boolean {
  return (
    values.businessName.trim() !== '' &&
    values.addressLine.trim() !== '' &&
    values.stateId !== '' &&
    values.cityId !== ''
  );
}

/** Whether SO2 can be carried on: at least one category, so there are Trade Standards to apply. */
export function categoryComplete(values: SellValues): boolean {
  return values.categories.length > 0;
}

/**
 * Whether SO3 can be carried on: the CAC number and the three documents. The reference's "Skip for now" is gone,
 * because a merchant application cannot be submitted without them.
 */
export function businessComplete(values: SellValues, application: MerchantApplication | null): boolean {
  return (
    values.cacRcNumber.trim() !== '' &&
    REQUIRED_DOCUMENTS.every((docType) => hasDocument(application, docType))
  );
}

/** The requested changes a person is asked to fix, grouped by the step that holds them, in step order. */
export function changesByStep(
  changes: readonly MerchantChangeItem[],
): { step: SellStep; items: MerchantChangeItem[] }[] {
  const groups = new Map<SellStep, MerchantChangeItem[]>();
  for (const change of changes) {
    const step = stepForChange(change);
    groups.set(step, [...(groups.get(step) ?? []), change]);
  }
  return SELL_STEPS.filter((step) => groups.has(step)).map((step) => ({
    step,
    items: groups.get(step) ?? [],
  }));
}

/** The first step a person still has to finish, so "continue" goes to the right screen. */
export function nextStep(values: SellValues, application: MerchantApplication | null): SellStep {
  if (!startComplete(values)) return 'start';
  if (!categoryComplete(values)) return 'category';
  if (!businessComplete(values, application)) return 'verify-business';
  return 'payout';
}
