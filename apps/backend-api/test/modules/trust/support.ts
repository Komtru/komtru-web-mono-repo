// A hand-written TrustStore and the pieces around it, so this module's decisions can be tested
// without a database. The SQL behind the real store is covered by test/integration/verification.int.test.ts.
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../../src/config/env.js';
import { createEncryption, type Encryption } from '../../../src/platform/crypto/encryption.js';
import { createHmacHasher, type HmacHasher } from '../../../src/platform/crypto/hmac.js';
import { createLogger, type Logger } from '../../../src/platform/logger.js';
import type { VerificationRequest } from '../../../src/modules/trust/index.js';
import type {
  DuplicateIdentityInput,
  ExpiredRequest,
  GrantInput,
  IdentityFactsRow,
  IdentityOutcomeInput,
  LevelOutcome,
  LivenessOutcomeInput,
  ProviderCallInput,
  RevokeInput,
  SelfieFile,
  TrustStore,
  VerificationSubject,
} from '../../../src/modules/trust/infrastructure/postgres/store.js';

export const silentLogger = (): Logger => createLogger({ log: { level: 'silent', format: 'json' } } as never);

/** 32 bytes of hex: `parseEncryptionKey` wants a real key, and a test should use a real one. */
export const testEncryption = (): Encryption =>
  createEncryption({ crypto: { encryptionKey: 'a1'.repeat(32) } } as AppConfig);

export const testHasher = (): HmacHasher => createHmacHasher('pepper'.padEnd(32, 'x'));

export const requestRow = (overrides: Partial<VerificationRequest> = {}): VerificationRequest => ({
  id: randomUUID(),
  userId: randomUUID(),
  verificationType: 'NIN',
  status: 'SUBMITTED',
  provider: null,
  providerReference: null,
  targetLevel: 2,
  attemptCount: 0,
  selfieStorageRef: null,
  submittedAt: new Date(),
  providerCalledAt: null,
  decidedAt: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  rejectionReason: null,
  metadata: null,
  ...overrides,
});

export interface RecordedStore extends TrustStore {
  readonly requests: VerificationRequest[];
  readonly providerCalls: ProviderCallInput[];
  readonly identityOutcomes: IdentityOutcomeInput[];
  readonly duplicates: DuplicateIdentityInput[];
  readonly livenessOutcomes: LivenessOutcomeInput[];
  readonly grants: GrantInput[];
  readonly revokes: RevokeInput[];
}

export interface StubStoreOptions {
  subject?: VerificationSubject | undefined;
  facts?: Partial<IdentityFactsRow>;
  selfie?: SelfieFile | undefined;
  request?: VerificationRequest | undefined;
  openRequests?: VerificationRequest[];
  identifierOwner?: string | undefined;
  attempts?: number;
  expired?: ExpiredRequest[];
  createRequestThrows?: unknown;
  applyIdentityOutcomeThrows?: unknown;
  grantResult?: LevelOutcome;
}

/** Records what it was asked to write, so a test asserts over the writes rather than over SQL. */
export function stubStore(options: StubStoreOptions = {}): RecordedStore {
  const requests: VerificationRequest[] = [];
  const providerCalls: ProviderCallInput[] = [];
  const identityOutcomes: IdentityOutcomeInput[] = [];
  const duplicates: DuplicateIdentityInput[] = [];
  const livenessOutcomes: LivenessOutcomeInput[] = [];
  const grants: GrantInput[] = [];
  const revokes: RevokeInput[] = [];
  let thrownOnce = false;

  return {
    requests,
    providerCalls,
    identityOutcomes,
    duplicates,
    livenessOutcomes,
    grants,
    revokes,

    // `in` rather than `=== undefined`: a test that passes `{ subject: undefined }` is saying "this
    // user is gone", which is a case worth being able to express.
    findSubject: (userId) =>
      Promise.resolve(
        'subject' in options
          ? options.subject
          : { userId, status: 'ACTIVE', verificationLevel: 'CONTACT_VERIFIED' },
      ),

    createRequest: (input) => {
      if (options.createRequestThrows) return Promise.reject(options.createRequestThrows);
      const row = requestRow({
        userId: input.userId,
        verificationType: input.verificationType,
        targetLevel: input.targetLevel,
        attemptCount: input.attemptCount,
        selfieStorageRef: input.selfieStorageRef ?? null,
      });
      requests.push(row);
      return Promise.resolve(row);
    },

    findRequest: () => Promise.resolve(options.request),
    listOpenRequests: () => Promise.resolve(options.openRequests ?? []),
    markProviderPending: () => Promise.resolve(),
    recordProviderCall: (input) => {
      providerCalls.push(input);
      return Promise.resolve();
    },

    applyIdentityOutcome: (input) => {
      // Throws once, so a test can prove the retry-after-duplicate path rather than only the throw.
      if (options.applyIdentityOutcomeThrows && !thrownOnce) {
        thrownOnce = true;
        return Promise.reject(options.applyIdentityOutcomeThrows);
      }
      identityOutcomes.push(input);
      return Promise.resolve();
    },

    applyLivenessOutcome: (input) => {
      livenessOutcomes.push(input);
      return Promise.resolve();
    },

    applyDuplicateIdentity: (input) => {
      duplicates.push(input);
      return Promise.resolve();
    },
    findIdentifierOwner: () => Promise.resolve(options.identifierOwner),

    identityFacts: () =>
      Promise.resolve({
        identifierVerified: false,
        livenessPassed: false,
        ...options.facts,
      }),

    grantLevel: (input) => {
      grants.push(input);
      return Promise.resolve(options.grantResult ?? { changed: true, from: 1, to: input.toLevel });
    },

    revokeLevel: (input) => {
      revokes.push(input);
      return Promise.resolve({ changed: true, from: 2, to: input.toLevel });
    },

    findKycSelfie: () => Promise.resolve(options.selfie),
    countAttempts: () => Promise.resolve(options.attempts ?? 0),
    expireStale: () => Promise.resolve(options.expired ?? []),
  };
}

/** A drizzle-shaped unique violation: the `pg` error on `cause`, which is what db/errors.ts walks. */
export const uniqueViolation = (constraint: string): Error =>
  new Error('Failed query', {
    cause: Object.assign(new Error('duplicate key'), { code: '23505', constraint }),
  });
