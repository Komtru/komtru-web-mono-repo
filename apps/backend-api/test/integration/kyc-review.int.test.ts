// The trust module against a real database: the SQL the unit tests mock out, the constraints that
// only exist in Postgres, and the acceptance criterion that cannot be proved anywhere else — that
// after a verification run the raw number is in no column of no table.
//
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/platform/logger.js';
import { createEncryption } from '../../src/platform/crypto/encryption.js';
import { createHmacHasher } from '../../src/platform/crypto/hmac.js';
import type { AppConfig } from '../../src/config/env.js';
import { bindStore } from '../../src/modules/trust/infrastructure/postgres/bind-store.js';
import { createFakeKycClient } from '../../src/modules/trust/infrastructure/providers/fake-kyc.client.js';
import { createFakeSocialClient } from '../../src/modules/trust/infrastructure/providers/fake-social.client.js';
import { runExpireStale } from '../../src/modules/trust/jobs/expire-stale.job.js';
import { runIdentityCheck } from '../../src/modules/trust/jobs/run-identity-check.job.js';
import { runLivenessCheck } from '../../src/modules/trust/jobs/run-liveness-check.job.js';
import { runBankMatchCheck } from '../../src/modules/trust/jobs/run-bank-match.job.js';
import { runBusinessCheck } from '../../src/modules/trust/jobs/run-business-check.job.js';
import { runSocialProofCheck } from '../../src/modules/trust/jobs/run-social-proof-check.job.js';
import type { TrustJobDeps } from '../../src/modules/trust/jobs/deps.js';
import { submitBusinessCheck } from '../../src/modules/trust/services/business.service.js';
import {
  readBankNameMatch,
  submitBankMatchCheck,
} from '../../src/modules/trust/services/bankMatch.service.js';
import { submitAddressCheck } from '../../src/modules/trust/services/address.service.js';
import {
  claimSocialHandle,
  listSocialProof,
  requestSocialProofCheck,
} from '../../src/modules/trust/services/socialProof.service.js';
import {
  submitIdentifierCheck,
  submitLivenessCheck,
  readVerificationStatus,
} from '../../src/modules/trust/services/verification.service.js';
import type { VerificationDeps } from '../../src/modules/trust/services/verification.service.js';
import { infraEnabled } from '../support/db-urls.js';
import { useTestDatabase } from '../support/db.js';
import { insertUser, sqlState } from '../modules/notify/support.js';

/** Ends in 4, so the fake passes it. The whole point is that this string never reaches a column. */
const RAW_NIN = '22222222224';
const RAW_BVN = '33333333334';
const FIRST_NAME = 'Ngozi';
const LAST_NAME = 'Adeyemi';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);
const encryption = createEncryption({ crypto: { encryptionKey: 'a1'.repeat(32) } } as AppConfig);
const hasher = createHmacHasher('pepper'.padEnd(32, 'x'));

describe.runIf(infraEnabled)('trust against a real database', () => {
  const database = useTestDatabase();

  const serviceDeps = (): VerificationDeps => ({
    store: bindStore(database.db()),
    hasher,
    encryption,
    requestTtlMinutes: 60,
    logger,
  });

  const jobDeps = (): TrustJobDeps => ({
    store: bindStore(database.db()),
    adapter: createFakeKycClient(),
    hasher,
    encryption,
    gateway: {
      emitToUser: () => {},
      emitToRoom: () => {},
      registerRoomAuthorizer: () => {},
      disconnectUser: () => {},
      connectionCount: () => 0,
    },
    logger,
  });

  /** A CONTACT_VERIFIED, ACTIVE user — the state M6 §2 requires before an identity check. */
  const verifiedContactUser = (): Promise<string> =>
    insertUser(database.app(), { status: 'ACTIVE', verification_level: 'CONTACT_VERIFIED' });

  /** A READY, ACTIVE KYC_DOCUMENT owned by `userId`, so the liveness submission accepts it. */
  const kycSelfie = async (userId: string, suffix = '1'): Promise<string> => {
    const owner = database.owner();
    /**
     * One storage account per test, reused.
     *
     * It used to INSERT unconditionally with a literal `cloud_name` and `credential_env_prefix`,
     * both of which are unique — so the helper worked exactly once per test, and silently only
     * while no test needed two KYC documents for one user. Reusing the row is also the truthful
     * shape: a pool holds one account and many files hang off it.
     */
    const { rows: accounts } = await owner.query<{ id: string }>(
      `WITH existing AS (SELECT id FROM files.storage_accounts WHERE pool = 'TRADE_ASSET' LIMIT 1),
            created AS (
              INSERT INTO files.storage_accounts
                (pool, label, cloud_name, credential_env_prefix, status)
              SELECT 'TRADE_ASSET', $1, 'c', 'CLOUDINARY_TRADE_1', 'ACTIVE'
               WHERE NOT EXISTS (SELECT 1 FROM existing)
              RETURNING id
            )
       SELECT id FROM existing UNION ALL SELECT id FROM created`,
      [`acct-${randomUUID().slice(0, 8)}`],
    );
    const accountId = accounts[0]?.id;
    // The last hex character drives the fake's liveness script: anything but d/e/f passes.
    const fileId = `00000000-0000-4000-8000-00000000000${suffix}`;
    await owner.query(
      `INSERT INTO files.file_records
         (id, uploader_user_id, owning_module, category, visibility, storage_account_id,
          storage_object_id, content_type, upload_state, status)
       VALUES ($1, $2, 'trust', 'KYC_DOCUMENT', 'PRIVATE_OWNER', $3, $4, 'image/jpeg', 'READY', 'ACTIVE')`,
      [fileId, userId, accountId, randomUUID()],
    );
    return fileId;
  };

  const runNin = async (userId: string, nin = RAW_NIN): Promise<string> => {
    const submitted = await submitIdentifierCheck(serviceDeps(), {
      userId,
      type: 'NIN',
      identifier: nin,
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
    });
    await runIdentityCheck(jobDeps(), { requestId: submitted.requestId, sealed: submitted.job.sealed });
    return submitted.requestId;
  };

  const runLiveness = async (userId: string, suffix = '1'): Promise<string> => {
    const submitted = await submitLivenessCheck(serviceDeps(), {
      userId,
      selfieFileId: await kycSelfie(userId, suffix),
    });
    await runLivenessCheck(jobDeps(), { requestId: submitted.requestId });
    return submitted.requestId;
  };

  const levelOf = async (userId: string): Promise<string> => {
    const { rows } = await database
      .app()
      .query<{ level: string }>(`SELECT verification_level AS level FROM identity.users WHERE id = $1`, [
        userId,
      ]);
    return rows[0]?.level ?? 'missing';
  };

  // --- T-051: business verification, bank name-match, address, social proof ---------------------

  /** The fake's scripted pass: an RC ending in 7 is active with the submitter as an officer. */
  const RC_NUMBER = '1487327';
  const RC_BUSINESS_NAME = `FAKE ENTERPRISES ${RC_NUMBER} LIMITED`;
  /** Ends in 7: the fake resolves it to the expected name exactly. */
  const RAW_ACCOUNT = '0123456787';
  const BANK_CODE = '058';

  /** A user at level 2, which §4 requires before any of this. */
  const identityVerifiedUser = async (suffix = '1', nin = RAW_NIN): Promise<string> => {
    const userId = await verifiedContactUser();
    await runNin(userId, nin);
    await runLiveness(userId, suffix);
    return userId;
  };

  const runBusiness = async (userId: string, rcNumber = RC_NUMBER): Promise<string> => {
    const submitted = await submitBusinessCheck(serviceDeps(), {
      userId,
      rcNumber,
    });
    await runBusinessCheck(jobDeps(), { requestId: submitted.requestId, sealed: submitted.job.sealed });
    return submitted.requestId;
  };

  const runBankMatch = async (userId: string, accountNumber = RAW_ACCOUNT): Promise<string> => {
    const submitted = await submitBankMatchCheck(serviceDeps(), {
      userId,
      accountNumber,
      bankCode: BANK_CODE,
    });
    await runBankMatchCheck(jobDeps(), { requestId: submitted.requestId, sealed: submitted.job.sealed });
    return submitted.requestId;
  };

  const owner = () => database.owner();
  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => {
    const { rows } = await owner().query<T>(sql, params);
    const [row] = rows;
    if (!row) throw new Error(`expected a row from: ${sql}`);
    return row;
  };
  const caseFor = (requestId: string) =>
    owner()
      .query<{
        id: string;
        type: string;
        state: string;
        priority: string;
        facts: Record<string, unknown>;
        subject_type: string;
      }>(`SELECT * FROM cases.cases WHERE subject_type = 'verification_request' AND subject_id = $1`, [
        requestId,
      ])
      .then((r) => r.rows);
  const eventCount = async (name: string): Promise<number> =>
    Number(
      (await one<{ n: string }>(`SELECT count(*) AS n FROM platform.outbox WHERE event_type = $1`, [name])).n,
    );

  describe('parking a request for review', () => {
    it('writes a duplicate flag and an IDENTITY case for a NIN already verified elsewhere, and decides nothing', async () => {
      const first = await identityVerifiedUser('1', RAW_NIN);
      const second = await verifiedContactUser();
      const requestId = await runNin(second);

      const flag = await one<{
        status: string;
        first_user_id: string;
        conflicting_user_id: string;
        identifier_type: string;
        request_id: string;
      }>(`SELECT * FROM trust.duplicate_identity_flags`);
      expect(flag).toMatchObject({
        status: 'OPEN',
        first_user_id: first,
        conflicting_user_id: second,
        identifier_type: 'NIN',
        request_id: requestId,
      });

      const cases = await caseFor(requestId);
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({ type: 'IDENTITY', state: 'OPEN', priority: 'HIGH' });
      expect(cases[0]?.facts).toMatchObject({ duplicateIdentity: true, verificationType: 'NIN' });

      // Never auto-approved, never auto-rejected.
      const request = await one<{ status: string }>(
        `SELECT status FROM trust.verification_requests WHERE id = $1`,
        [requestId],
      );
      expect(request.status).toBe('MANUAL_REVIEW');
      expect(await levelOf(second)).toBe('CONTACT_VERIFIED');
      expect(await levelOf(first)).toBe('IDENTITY_VERIFIED');
      expect(await eventCount('trust.verification.rejected')).toBe(0);
    });

    it('writes a KYB case and a CAC flag for a registration another account already holds', async () => {
      const first = await identityVerifiedUser('1', RAW_NIN);
      await runBusiness(first);
      const second = await identityVerifiedUser('2', '22222222225');
      const requestId = await runBusiness(second, RC_NUMBER);

      const flag = await one<{ identifier_type: string; status: string }>(
        `SELECT identifier_type, status FROM trust.duplicate_identity_flags WHERE request_id = $1`,
        [requestId],
      );
      expect(flag).toEqual({ identifier_type: 'CAC', status: 'OPEN' });
      const [kyb] = await caseFor(requestId);
      expect(kyb).toMatchObject({ type: 'KYB', priority: 'HIGH' });
    });

    it('registers an ordinary low-confidence review as an unflagged IDENTITY case', async () => {
      const userId = await verifiedContactUser();
      const requestId = await runNin(userId, '22222222222');
      const [row] = await caseFor(requestId);
      expect(row).toMatchObject({ type: 'IDENTITY', priority: 'NORMAL' });
      expect(row?.facts).toMatchObject({ duplicateIdentity: false });
      expect(
        Number((await one<{ n: string }>(`SELECT count(*) AS n FROM trust.duplicate_identity_flags`)).n),
      ).toBe(0);
    });

    it('registers an address proof as an IDENTITY case, in the submitting transaction', async () => {
      const userId = await identityVerifiedUser();
      const submitted = await submitAddressCheck(serviceDeps(), {
        userId,
        addressLine1: '1 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        method: 'UTILITY_BILL',
        documentFileId: await kycSelfie(userId, '2'),
      });
      const [row] = await caseFor(submitted.requestId);
      expect(row).toMatchObject({ type: 'IDENTITY', state: 'OPEN' });
    });
  });

  describe('two rejections within 30 days', () => {
    const rejectNin = (userId: string, nin: string) => runNin(userId, nin);

    it('publishes one repeated-rejection event, on the second rejection only', async () => {
      const userId = await verifiedContactUser();
      await rejectNin(userId, '11111111111');
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(0);

      await rejectNin(userId, '11111111121');
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(1);
      const payload = (
        await one<{ payload: { userId: string; rejectionCount: number; windowDays: number } }>(
          `SELECT payload FROM platform.outbox WHERE event_type = 'trust.verification.repeated_rejection'`,
        )
      ).payload;
      expect(payload).toMatchObject({ userId, rejectionCount: 2, windowDays: 30 });

      await rejectNin(userId, '11111111131');
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(1);
    });

    it('does not count a rejection older than 30 days', async () => {
      const userId = await verifiedContactUser();
      await rejectNin(userId, '11111111111');
      await owner().query(`UPDATE trust.verification_requests SET decided_at = now() - interval '31 days'`);
      await rejectNin(userId, '11111111121');
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(0);
    });
  });
});
