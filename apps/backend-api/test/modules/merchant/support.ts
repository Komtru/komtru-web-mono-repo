// A stand-in for the six questions the merchant module asks of other modules (services/ports.ts), so
// the services are tested against a real database without a Cloudinary account, a catalogue or a queue.
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type {
  EvidenceJob,
  FileFacts,
  MerchantPorts,
  PayoutAccountFacts,
  StaffViewer,
} from '../../../src/modules/merchant/services/ports.js';
import { silentLogger } from '../trust/support.js';

export interface StubPorts extends MerchantPorts {
  files: Map<string, FileFacts>;
  payouts: Map<string, PayoutAccountFacts & { userId: string }>;
  granted: string[];
  revoked: string[];
  enqueued: { job: EvidenceJob; delayMs: number | undefined }[];
  cacRequests: { userId: string; rcNumber: string }[];
  signed: { fileId: string; viewer: StaffViewer }[];
  failGrant: boolean;
  failEnqueue: boolean;
  categories: string[];
  cityOf: Map<string, string>;
}

export const STATE_ID = randomUUID();
export const CITY_ID = randomUUID();

export function stubPorts(): StubPorts {
  const ports: StubPorts = {
    files: new Map(),
    payouts: new Map(),
    granted: [],
    revoked: [],
    enqueued: [],
    cacRequests: [],
    signed: [],
    failGrant: false,
    failEnqueue: false,
    categories: ['PHONES', 'LAPTOPS'],
    cityOf: new Map([[CITY_ID, STATE_ID]]),
    findFile: (fileId) => Promise.resolve(ports.files.get(fileId)),
    grantReviewerAccess: (fileId) => {
      if (ports.failGrant) return Promise.reject(new Error('grant failed'));
      ports.granted.push(fileId);
      return Promise.resolve();
    },
    revokeReviewerAccess: (fileId) => {
      ports.revoked.push(fileId);
      return Promise.resolve();
    },
    cityBelongsToState: (stateId, cityId) => Promise.resolve(ports.cityOf.get(cityId) === stateId),
    locationLabel: (cityId) =>
      Promise.resolve(ports.cityOf.has(cityId) ? { stateName: 'Lagos', cityName: 'Ikeja' } : undefined),
    categoryCodes: () => Promise.resolve(ports.categories),
    payoutAccountOf: (userId, id) => {
      const account = ports.payouts.get(id);
      return Promise.resolve(account && account.userId === userId ? account : undefined);
    },
    signDocument: (fileId, viewer) => {
      ports.signed.push({ fileId, viewer });
      const file = ports.files.get(fileId);
      return Promise.resolve(
        file && file.status === 'ACTIVE'
          ? {
              url: `https://files.test/${fileId}`,
              expiresAt: new Date(Date.now() + 300_000),
              contentType: file.contentType,
            }
          : undefined,
      );
    },
    requestCacLookup: (input) => {
      ports.cacRequests.push(input);
      return Promise.resolve({ outcome: 'ENQUEUED' });
    },
    enqueueEvidence: (job, delayMs) => {
      if (ports.failEnqueue) return Promise.reject(new Error('redis down'));
      ports.enqueued.push({ job, delayMs });
      return Promise.resolve();
    },
  };
  return ports;
}

/** A KYC document the applicant uploaded and the platform finished. */
export function addFile(ports: StubPorts, userId: string, overrides: Partial<FileFacts> = {}): string {
  const id = randomUUID();
  ports.files.set(id, {
    id,
    uploaderUserId: userId,
    category: 'KYC_DOCUMENT',
    status: 'ACTIVE',
    uploadState: 'READY',
    contentType: 'application/pdf',
    ...overrides,
  });
  return id;
}

export function addPayout(
  ports: StubPorts,
  userId: string,
  overrides: Partial<PayoutAccountFacts> = {},
): string {
  const id = randomUUID();
  ports.payouts.set(id, {
    id,
    userId,
    status: 'VERIFIED',
    bankName: 'Access Bank',
    accountNumberMasked: '******5567',
    accountName: 'TECHEDGE NIGERIA LTD',
    nameMatchResult: 'EXACT',
    ...overrides,
  });
  return id;
}

export const logger = silentLogger();

/** Every field and document a complete application needs, with files the applicant owns. */
export function completeDraft(ports: StubPorts, userId: string) {
  return {
    businessName: 'Techedge Nigeria Ltd',
    businessType: 'REGISTERED_BUSINESS' as const,
    addressLine: '12 Allen Avenue',
    stateId: STATE_ID,
    cityId: CITY_ID,
    categories: ['PHONES'],
    cacRcNumber: 'RC 123456',
    payoutAccountId: addPayout(ports, userId),
    documents: [
      { docType: 'CAC_CERTIFICATE' as const, fileId: addFile(ports, userId) },
      { docType: 'STATUS_REPORT' as const, fileId: addFile(ports, userId) },
      { docType: 'DIRECTOR_ID' as const, fileId: addFile(ports, userId, { contentType: 'image/jpeg' }) },
    ],
  };
}

// Asymmetric matchers typed as `unknown`, so nesting one inside an object literal does not widen it to `any`.
export const anyString = (): unknown => expect.any(String);
export const matching = (pattern: RegExp): unknown => expect.stringMatching(pattern);
export const arrayWith = (items: unknown[]): unknown => expect.arrayContaining(items);
