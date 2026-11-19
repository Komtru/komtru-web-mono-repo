// T-121: what the seller onboarding screens decide. Which screen a person sees, which step holds a field, and what
// each step saves.
import type { MerchantApplication } from '@komtru/api-client';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_VALUES,
  businessComplete,
  categoryComplete,
  changeLabel,
  changesByStep,
  documentsWith,
  nextStep,
  phaseOf,
  startComplete,
  stepBody,
  stepForChange,
  valuesFrom,
  type SellValues,
} from '../src/sell/rules';

const uuid = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const application = (over: Partial<MerchantApplication> = {}): MerchantApplication => ({
  id: uuid(1),
  status: 'DRAFT',
  form: {},
  documents: [],
  changesRequested: [],
  lastDecision: null,
  canEdit: true,
  submissionCount: 0,
  submittedAt: null,
  decidedAt: null,
  createdAt: '2026-11-14T10:00:00.000Z',
  ...over,
});

const complete: SellValues = {
  businessName: 'TechEdge NG',
  addressLine: '12 Allen Avenue',
  stateId: uuid(2),
  cityId: uuid(3),
  categories: ['ELECTRONICS'],
  cacRcNumber: 'RC 1487XXX',
  payoutAccountId: uuid(4),
};

const withAllDocuments = application({
  documents: [
    { docType: 'CAC_CERTIFICATE', label: 'CAC', fileId: uuid(10) },
    { docType: 'STATUS_REPORT', label: 'Status report', fileId: uuid(11) },
    { docType: 'DIRECTOR_ID', label: 'ID', fileId: uuid(12) },
  ],
});

describe('phaseOf', () => {
  it('reads who the person is from where their application stands', () => {
    expect(phaseOf(null)).toBe('NOT_STARTED');
    expect(phaseOf(application({ status: 'DRAFT' }))).toBe('DRAFTING');
    expect(phaseOf(application({ status: 'SUBMITTED' }))).toBe('IN_REVIEW');
    expect(phaseOf(application({ status: 'IN_REVIEW' }))).toBe('IN_REVIEW');
    expect(phaseOf(application({ status: 'CHANGES_REQUESTED' }))).toBe('CHANGES_REQUESTED');
    expect(phaseOf(application({ status: 'APPROVED' }))).toBe('APPROVED');
    expect(phaseOf(application({ status: 'REJECTED' }))).toBe('REJECTED');
  });
});

describe('step completeness', () => {
  it('needs a name, an address, a state and a city before SO1 carries on', () => {
    expect(startComplete(complete)).toBe(true);
    expect(startComplete({ ...complete, businessName: '   ' })).toBe(false);
    expect(startComplete({ ...complete, cityId: '' })).toBe(false);
  });

  it('needs at least one category before SO2 carries on', () => {
    expect(categoryComplete({ ...complete, categories: [] })).toBe(false);
    expect(categoryComplete(complete)).toBe(true);
  });

  it('needs the CAC number and all three documents before SO3 carries on', () => {
    expect(businessComplete(complete, withAllDocuments)).toBe(true);
    expect(businessComplete({ ...complete, cacRcNumber: '' }, withAllDocuments)).toBe(false);
    expect(
      businessComplete(complete, application({ documents: withAllDocuments.documents.slice(0, 2) })),
    ).toBe(false);
    expect(businessComplete(complete, null)).toBe(false);
  });
});

describe('nextStep', () => {
  it('sends the person to the first step they have not finished', () => {
    expect(nextStep(EMPTY_VALUES, null)).toBe('start');
    expect(nextStep({ ...complete, categories: [] }, null)).toBe('category');
    expect(nextStep(complete, null)).toBe('verify-business');
    expect(nextStep(complete, withAllDocuments)).toBe('payout');
  });
});

describe('stepBody', () => {
  it('sends only the fields the step owns, so one step cannot overwrite another', () => {
    expect(stepBody('category', complete)).toEqual({ categories: ['ELECTRONICS'] });
    expect(stepBody('payout', complete)).toEqual({ payoutAccountId: uuid(4) });
    expect(stepBody('start', { ...complete, businessName: '  TechEdge NG ' })).toEqual({
      businessName: 'TechEdge NG',
      addressLine: '12 Allen Avenue',
      stateId: uuid(2),
      cityId: uuid(3),
    });
  });

  it('marks the business as registered, because a CAC number is required', () => {
    expect(stepBody('verify-business', complete)).toEqual({
      businessType: 'REGISTERED_BUSINESS',
      cacRcNumber: 'RC 1487XXX',
    });
  });
});

describe('documentsWith', () => {
  it('replaces one document type and keeps the rest', () => {
    const next = documentsWith(withAllDocuments, 'CAC_CERTIFICATE', uuid(99));
    expect(next).toEqual([
      { docType: 'STATUS_REPORT', fileId: uuid(11) },
      { docType: 'DIRECTOR_ID', fileId: uuid(12) },
      { docType: 'CAC_CERTIFICATE', fileId: uuid(99) },
    ]);
  });

  it('drops a document type when it is cleared', () => {
    expect(documentsWith(withAllDocuments, 'DIRECTOR_ID', null).map((d) => d.docType)).toEqual([
      'CAC_CERTIFICATE',
      'STATUS_REPORT',
    ]);
  });
});

describe('valuesFrom', () => {
  it('reads what the application already holds', () => {
    const values = valuesFrom(
      application({ form: { businessName: 'TechEdge NG', categories: ['ELECTRONICS'] } }),
    );
    expect(values.businessName).toBe('TechEdge NG');
    expect(values.categories).toEqual(['ELECTRONICS']);
    expect(values.cacRcNumber).toBe('');
  });
});

describe('requested changes', () => {
  it('names the step that holds each change', () => {
    expect(stepForChange({ kind: 'FIELD', key: 'cityId' })).toBe('start');
    expect(stepForChange({ kind: 'FIELD', key: 'categories' })).toBe('category');
    expect(stepForChange({ kind: 'FIELD', key: 'cacRcNumber' })).toBe('verify-business');
    expect(stepForChange({ kind: 'DOCUMENT', key: 'DIRECTOR_ID' })).toBe('verify-business');
    expect(stepForChange({ kind: 'FIELD', key: 'payoutAccountId' })).toBe('payout');
  });

  it('groups changes by step in the order the steps come', () => {
    const groups = changesByStep([
      { kind: 'FIELD', key: 'payoutAccountId' },
      { kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' },
      { kind: 'FIELD', key: 'businessName' },
    ]);
    expect(groups.map((group) => group.step)).toEqual(['start', 'verify-business', 'payout']);
  });

  it('labels a change the way the form does, and shows an unknown key as it came', () => {
    expect(changeLabel({ kind: 'FIELD', key: 'cacRcNumber' })).toBe('CAC registration number');
    expect(changeLabel({ kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' })).toBe('CAC certificate');
    expect(changeLabel({ kind: 'FIELD', key: 'somethingNew' })).toBe('somethingNew');
  });
});
