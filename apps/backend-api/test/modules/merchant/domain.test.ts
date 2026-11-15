import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isLive,
  MERCHANT_APPLICATION_STATUSES,
} from '../../../src/modules/merchant/domain/status.js';
import {
  cacDocumentsPresent,
  missingDocuments,
  missingFields,
  validateChangeItems,
  type ApplicationForm,
} from '../../../src/modules/merchant/domain/application.js';
import { slugCandidates, slugify } from '../../../src/modules/merchant/domain/slug.js';
import { deriveFacts, type EvidenceMatrix } from '../../../src/modules/merchant/domain/evidence.js';
import { decisionLine } from '../../../src/modules/merchant/domain/notification.js';

const FORM: ApplicationForm = {
  businessName: 'Techedge Nigeria Ltd',
  businessType: 'REGISTERED_BUSINESS',
  addressLine: '12 Allen Avenue',
  stateId: '11111111-1111-4111-8111-111111111111',
  cityId: '22222222-2222-4222-8222-222222222222',
  categories: ['PHONES'],
  cacRcNumber: 'RC123456',
  payoutAccountId: '33333333-3333-4333-8333-333333333333',
};

describe('the application status machine', () => {
  it('names the six statuses of the ticket', () => {
    expect([...MERCHANT_APPLICATION_STATUSES]).toEqual([
      'DRAFT',
      'SUBMITTED',
      'IN_REVIEW',
      'CHANGES_REQUESTED',
      'APPROVED',
      'REJECTED',
    ]);
  });

  it('moves forward only along the review path', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'IN_REVIEW')).toBe(true);
    expect(canTransition('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransition('IN_REVIEW', 'CHANGES_REQUESTED')).toBe(true);
    expect(canTransition('CHANGES_REQUESTED', 'SUBMITTED')).toBe(true);
    expect(canTransition('IN_REVIEW', 'REJECTED')).toBe(true);
  });

  it('refuses a skip, a repeat and any move out of a terminal status', () => {
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransition('DRAFT', 'DRAFT')).toBe(false);
    expect(canTransition('CHANGES_REQUESTED', 'APPROVED')).toBe(false);
    for (const to of MERCHANT_APPLICATION_STATUSES) {
      expect(canTransition('APPROVED', to)).toBe(false);
      expect(canTransition('REJECTED', to)).toBe(false);
    }
  });

  it('treats everything but a decision as live', () => {
    expect(MERCHANT_APPLICATION_STATUSES.filter(isLive)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'IN_REVIEW',
      'CHANGES_REQUESTED',
    ]);
  });
});

describe('the document checklist', () => {
  it('needs the CAC certificate and either a status report or a memorandum', () => {
    expect(cacDocumentsPresent(['CAC_CERTIFICATE'])).toBe(false);
    expect(cacDocumentsPresent(['STATUS_REPORT'])).toBe(false);
    expect(cacDocumentsPresent(['CAC_CERTIFICATE', 'STATUS_REPORT'])).toBe(true);
    expect(cacDocumentsPresent(['CAC_CERTIFICATE', 'MEMORANDUM'])).toBe(true);
  });

  it('lists what is missing, including the proprietor ID', () => {
    expect(missingDocuments([])).toEqual(['CAC_CERTIFICATE', 'STATUS_REPORT_OR_MEMORANDUM', 'DIRECTOR_ID']);
    expect(missingDocuments(['CAC_CERTIFICATE', 'MEMORANDUM'])).toEqual(['DIRECTOR_ID']);
    expect(missingDocuments(['CAC_CERTIFICATE', 'MEMORANDUM', 'DIRECTOR_ID'])).toEqual([]);
  });
});

describe('the form checklist', () => {
  it('is complete for a full form', () => {
    expect(missingFields(FORM)).toEqual([]);
  });

  it('names each missing field, treating blanks and an empty category list as missing', () => {
    expect(missingFields({})).toEqual([
      'businessName',
      'businessType',
      'addressLine',
      'stateId',
      'cityId',
      'categories',
      'cacRcNumber',
      'payoutAccountId',
    ]);
    expect(missingFields({ ...FORM, businessName: '   ', categories: [] })).toEqual([
      'businessName',
      'categories',
    ]);
  });
});

describe('requested changes', () => {
  it('accepts named documents and fields, and nothing else', () => {
    expect(
      validateChangeItems([
        { kind: 'DOCUMENT', key: 'CAC_CERTIFICATE', note: 'The scan is cut off' },
        { kind: 'FIELD', key: 'cacRcNumber' },
      ]),
    ).toEqual({ ok: true });
    expect(validateChangeItems([])).toMatchObject({ ok: false });
    expect(validateChangeItems([{ kind: 'DOCUMENT', key: 'PASSPORT' }])).toMatchObject({ ok: false });
    expect(validateChangeItems([{ kind: 'FIELD', key: 'payoutAccount' }])).toMatchObject({ ok: false });
  });
});

describe('the storefront slug', () => {
  it('lower-cases, strips accents and punctuation and joins with single hyphens', () => {
    expect(slugify('Techedge Nigeria Ltd.')).toBe('techedge-nigeria-ltd');
    expect(slugify("  Ọlá's  Phones & Gadgets!! ")).toBe('olas-phones-gadgets');
  });

  it('falls back to a fixed word when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('shop');
  });

  it('offers the plain slug first, then numbered ones, then random ones', () => {
    const candidates = slugCandidates('Techedge Ltd');
    expect(candidates.next().value).toBe('techedge-ltd');
    expect(candidates.next().value).toBe('techedge-ltd-2');
    expect(candidates.next().value).toBe('techedge-ltd-3');
  });
});

describe('the evidence facts the advisory reads', () => {
  const matrix = (over: Partial<EvidenceMatrix> = {}): EvidenceMatrix => ({
    identityLevel: 2,
    cacLookup: { state: 'VERIFIED' },
    documents: { required: [], present: [], missing: [], complete: true },
    bankNameMatch: { state: 'EXACT' },
    ...over,
  });

  it('is a checklist-complete case when the form and the documents are whole', () => {
    expect(deriveFacts(matrix(), { formComplete: true })).toMatchObject({
      checklistComplete: true,
      identityVerified: true,
      cacLookup: 'VERIFIED',
      bankNameMatch: 'EXACT',
    });
  });

  it('is incomplete when a document is missing or the form is not whole', () => {
    expect(
      deriveFacts(
        matrix({ documents: { required: [], present: [], missing: ['DIRECTOR_ID'], complete: false } }),
        {
          formComplete: true,
        },
      ).checklistComplete,
    ).toBe(false);
    expect(deriveFacts(matrix(), { formComplete: false }).checklistComplete).toBe(false);
  });

  it('carries scalars only, so the case index never holds a copy of the application', () => {
    const facts = deriveFacts(matrix({ identityLevel: 0, cacLookup: { state: 'NOT_RUN' } }), {
      formComplete: true,
    });
    expect(facts.identityVerified).toBe(false);
    for (const value of Object.values(facts)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });
});

describe('the decision notice', () => {
  it('congratulates on approval and never mentions the reason', () => {
    expect(decisionLine({ outcome: 'APPROVED', reason: 'internal note', requested: [] })).toMatch(
      /certified/,
    );
    expect(decisionLine({ outcome: 'APPROVED', reason: 'internal note', requested: [] })).not.toMatch(
      /internal/,
    );
  });

  it('names what to change in plain words, then gives the reviewer’s reason', () => {
    const line = decisionLine({
      outcome: 'CHANGES_REQUESTED',
      reason: 'The scan is cut off.',
      requested: [
        { kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' },
        { kind: 'FIELD', key: 'cacRcNumber' },
      ],
    });
    expect(line).toContain('CAC certificate, CAC registration number');
    expect(line).toContain('The scan is cut off.');
    expect(line).not.toMatch(/cacRcNumber|CAC_CERTIFICATE/);
  });

  it('gives the reason on rejection', () => {
    expect(decisionLine({ outcome: 'REJECTED', reason: 'The CAC number is not yours.', requested: [] })).toBe(
      'We could not approve it. The CAC number is not yours.',
    );
  });
});
