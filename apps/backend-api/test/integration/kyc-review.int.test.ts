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
import { insertUser } from '../modules/notify/support.js';
import { grantRole, seedUser } from '../modules/identity/support.js';
import { decideApproval } from '../../src/modules/identity/services/approval.service.js';
import {
  assignReview,
  decideReview,
  executeLevelOverride,
  getKycQueueItem,
  listKycQueue,
  requestOverride,
} from '../../src/modules/trust/services/review.service.js';
import {
  listDuplicateFlags,
  resolveDuplicateFlag,
} from '../../src/modules/trust/services/duplicate.service.js';

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

  // --- working the queue ------------------------------------------------------------------------

  const staff = async () => {
    const { userId } = await seedUser(database.owner());
    await grantRole(database.owner(), userId, 'KYC_ANALYST', []);
    return { userId, roles: ['KYC_ANALYST'] as const };
  };
  const requestStatus = async (requestId: string) =>
    (
      await one<{ status: string; reason: string | null }>(
        `SELECT status, rejection_reason AS reason FROM trust.verification_requests WHERE id = $1`,
        [requestId],
      )
    ).status;
  const apiStatus = async (attempt: Promise<unknown>): Promise<number | undefined> => {
    try {
      await attempt;
      return undefined;
    } catch (error) {
      return (error as { status?: number }).status ?? -1;
    }
  };
  const decisions = (requestId: string) =>
    owner()
      .query<{ outcome: string; policy_citation: string }>(
        `SELECT d.outcome, d.policy_citation FROM cases.case_decisions d
           JOIN cases.cases c ON c.id = d.case_id WHERE c.subject_id = $1`,
        [requestId],
      )
      .then((r) => r.rows);

  describe('the review queue', () => {
    it('lists IDENTITY and KYB items and serves a labelled advisory with a detail', async () => {
      const userId = await verifiedContactUser();
      const requestId = await runNin(userId, '22222222222');
      const queue = await listKycQueue(database.db(), { page: 1, limit: 20 });
      expect(queue.total).toBe(1);
      expect(queue.items[0]).toMatchObject({ requestId, caseType: 'IDENTITY', verificationType: 'NIN' });
      expect(queue.items[0]?.caseNumber).toMatch(/^C-\d{6}$/);
      expect(await listKycQueue(database.db(), { caseType: 'KYB', page: 1, limit: 20 })).toMatchObject({
        total: 0,
      });

      const detail = await getKycQueueItem(database.db(), requestId);
      expect(detail.advisory.label).toBe('AI-suggested — not a decision');
      expect(detail.advisory.suggestion.length).toBeGreaterThan(0);
    });

    it('refuses a decision from someone who has not taken the case', async () => {
      const userId = await verifiedContactUser();
      const requestId = await runNin(userId, '22222222222');
      const analyst = await staff();
      expect(
        await apiStatus(
          decideReview(database.db(), { actor: analyst, requestId, outcome: 'REJECT', reason: 'no' }),
        ),
      ).toBe(409);
      expect(await requestStatus(requestId)).toBe('MANUAL_REVIEW');
    });

    it('rejects with a reason code, records the decision with its citation, closes the case and publishes', async () => {
      const userId = await verifiedContactUser();
      const requestId = await runNin(userId, '22222222222');
      const analyst = await staff();
      await assignReview(database.db(), { actor: analyst, requestId });
      await decideReview(database.db(), {
        actor: analyst,
        requestId,
        outcome: 'REJECT',
        reason: 'Photo of the ID does not match the record',
      });
      expect(await requestStatus(requestId)).toBe('REJECTED');
      expect(
        (
          await one<{ reason: string }>(
            `SELECT rejection_reason AS reason FROM trust.verification_requests WHERE id = $1`,
            [requestId],
          )
        ).reason,
      ).toBe('REVIEW_DECLINED');
      expect(await decisions(requestId)).toEqual([{ outcome: 'REJECTED', policy_citation: 'M6 §6.8' }]);
      expect((await caseFor(requestId))[0]?.state).toBe('CLOSED');
      expect(await eventCount('trust.verification.review_decided')).toBe(1);
      expect(await eventCount('trust.verification.rejected')).toBe(1);
      // Decided once: the request has left the queue.
      expect(
        await apiStatus(
          decideReview(database.db(), { actor: analyst, requestId, outcome: 'APPROVE', reason: 'x' }),
        ),
      ).toBe(409);
    });

    it('approves, verifies the number and lets the level follow once liveness lands', async () => {
      const userId = await verifiedContactUser();
      const requestId = await runNin(userId, '22222222222');
      const analyst = await staff();
      await assignReview(database.db(), { actor: analyst, requestId });
      await decideReview(database.db(), {
        actor: analyst,
        requestId,
        outcome: 'APPROVE',
        reason: 'Documents check out',
      });
      expect(await requestStatus(requestId)).toBe('APPROVED');
      expect(
        (
          await one<{ v: Date | null }>(
            `SELECT verified_at AS v FROM trust.nin_verifications WHERE request_id = $1`,
            [requestId],
          )
        ).v,
      ).not.toBeNull();
      // Identity needs liveness as well; a person approving the number does not waive it.
      expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');
      await runLiveness(userId);
      expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');
    });
  });

  describe('duplicate flags', () => {
    const duplicatePair = async () => {
      const first = await identityVerifiedUser('1', RAW_NIN);
      const second = await verifiedContactUser();
      const requestId = await runNin(second);
      const flag = await one<{ id: string }>(`SELECT id FROM trust.duplicate_identity_flags`);
      return { first, second, requestId, flagId: flag.id };
    };

    it('does not let the queue decide a flagged request', async () => {
      const { requestId } = await duplicatePair();
      const analyst = await staff();
      await assignReview(database.db(), { actor: analyst, requestId });
      expect(
        await apiStatus(
          decideReview(database.db(), {
            actor: analyst,
            requestId,
            outcome: 'APPROVE',
            reason: 'looks fine',
          }),
        ),
      ).toBe(409);
      expect(await requestStatus(requestId)).toBe('MANUAL_REVIEW');
    });

    it('lists open flags without exposing the hash', async () => {
      await duplicatePair();
      const list = await listDuplicateFlags(database.db(), { status: 'OPEN', page: 1, limit: 10 });
      expect(list.total).toBe(1);
      expect(Object.keys(list.items[0] ?? {})).not.toContain('identifierHash');
    });

    it('confirms a duplicate by rejecting the second claim and leaving the first account alone', async () => {
      const { first, second, requestId, flagId } = await duplicatePair();
      const analyst = await staff();
      await assignReview(database.db(), { actor: analyst, requestId });
      const resolved = await resolveDuplicateFlag(database.db(), {
        actor: analyst,
        flagId,
        resolution: 'CONFIRMED_DUPLICATE',
        notes: 'Different people, same number',
      });
      expect(resolved).toMatchObject({ status: 'CONFIRMED_DUPLICATE', reviewedBy: analyst.userId });
      expect(await requestStatus(requestId)).toBe('REJECTED');
      expect(await levelOf(first)).toBe('IDENTITY_VERIFIED');
      expect(await levelOf(second)).toBe('CONTACT_VERIFIED');
      expect(await decisions(requestId)).toEqual([
        { outcome: 'DUPLICATE_CONFIRMED', policy_citation: 'M6 §7' },
      ]);
      expect(await eventCount('trust.verification.duplicate_flag_resolved')).toBe(1);
      // Resolved once.
      expect(
        await apiStatus(
          resolveDuplicateFlag(database.db(), {
            actor: analyst,
            flagId,
            resolution: 'CONFIRMED_DUPLICATE',
            notes: 'again',
          }),
        ),
      ).toBe(409);
    });

    it('escalates without deciding anything', async () => {
      const { requestId, flagId } = await duplicatePair();
      const analyst = await staff();
      const resolved = await resolveDuplicateFlag(database.db(), {
        actor: analyst,
        flagId,
        resolution: 'ESCALATED',
        notes: 'Needs a senior look',
      });
      expect(resolved.status).toBe('ESCALATED');
      expect(await requestStatus(requestId)).toBe('MANUAL_REVIEW');
      expect((await caseFor(requestId))[0]?.state).toBe('ESCALATED');
    });

    describe('clearing a false positive', () => {
      const approvalFor = async (requester: { userId: string; roles: readonly string[] }, flagId: string) => {
        const { approvalId } = await requestOverride(database.db(), {
          actor: requester,
          kind: 'CLEAR_DUPLICATE',
          flagId,
          reason: 'The first account was abandoned',
        });
        return approvalId;
      };
      const approve = (approver: { userId: string; roles: readonly string[] }, approvalId: string) =>
        decideApproval(
          { db: database.db() },
          { actor: approver, approvalId, decision: 'APPROVE', reason: 'Agreed' },
        );

      it('refuses without an approval id', async () => {
        const { requestId, flagId } = await duplicatePair();
        const analyst = await staff();
        await assignReview(database.db(), { actor: analyst, requestId });
        expect(
          await apiStatus(
            resolveDuplicateFlag(database.db(), {
              actor: analyst,
              flagId,
              resolution: 'CLEARED_FALSE_POSITIVE',
              notes: 'n',
            }),
          ),
        ).toBe(422);
      });

      it('refuses an approval nobody has signed', async () => {
        const { requestId, flagId } = await duplicatePair();
        const analyst = await staff();
        await assignReview(database.db(), { actor: analyst, requestId });
        const approvalId = await approvalFor(analyst, flagId);
        expect(
          await apiStatus(
            resolveDuplicateFlag(database.db(), {
              actor: analyst,
              flagId,
              resolution: 'CLEARED_FALSE_POSITIVE',
              notes: 'n',
              approvalId,
            }),
          ),
        ).toBe(403);
        expect(await requestStatus(requestId)).toBe('MANUAL_REVIEW');
      });

      it('does not let the requester approve their own request', async () => {
        const { flagId } = await duplicatePair();
        const analyst = await staff();
        const approvalId = await approvalFor(analyst, flagId);
        expect(await apiStatus(approve(analyst, approvalId))).toBe(403);
      });

      it('moves the identifier to the second account once a different holder has approved', async () => {
        const { first, second, requestId, flagId } = await duplicatePair();
        const requester = await staff();
        const approver = await staff();
        await assignReview(database.db(), { actor: requester, requestId });
        const approvalId = await approvalFor(requester, flagId);
        await approve(approver, approvalId);

        const resolved = await resolveDuplicateFlag(database.db(), {
          actor: requester,
          flagId,
          resolution: 'CLEARED_FALSE_POSITIVE',
          notes: 'Same person, abandoned first account',
          approvalId,
        });
        expect(resolved.status).toBe('CLEARED_FALSE_POSITIVE');
        expect(await requestStatus(requestId)).toBe('APPROVED');
        // The first account no longer holds the number, so it no longer earns level 2.
        expect(await levelOf(first)).toBe('CONTACT_VERIFIED');
        const { rows } = await owner().query<{ user_id: string }>(
          `SELECT user_id FROM trust.nin_verifications WHERE verified_at IS NOT NULL`,
        );
        expect(rows.map((r) => r.user_id)).toEqual([second]);
        await runLiveness(second, '2');
        expect(await levelOf(second)).toBe('IDENTITY_VERIFIED');
        // The approval is spent: it cannot clear another flag.
        expect(
          await apiStatus(
            resolveDuplicateFlag(database.db(), {
              actor: requester,
              flagId,
              resolution: 'CLEARED_FALSE_POSITIVE',
              notes: 'again',
              approvalId,
            }),
          ),
        ).toBe(409);
      });
    });
  });

  describe('verification.override', () => {
    const approve = (approver: { userId: string; roles: readonly string[] }, approvalId: string) =>
      decideApproval(
        { db: database.db() },
        { actor: approver, approvalId, decision: 'APPROVE', reason: 'ok' },
      );

    it('changes nothing until a different holder approves, then grants once', async () => {
      const userId = await verifiedContactUser();
      const requester = await staff();
      const approver = await staff();
      const { approvalId } = await requestOverride(database.db(), {
        actor: requester,
        kind: 'LEVEL',
        userId,
        direction: 'GRANT',
        toLevel: 2,
        reason: 'Verified in person at the hub',
      });
      const execute = (toLevel = 2) =>
        executeLevelOverride(database.db(), {
          actor: requester,
          approvalId,
          userId,
          direction: 'GRANT',
          toLevel,
          reason: 'Verified in person at the hub',
        });

      // Not approved yet: no single actor can do this alone.
      expect(await apiStatus(execute())).toBe(403);
      expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');

      await approve(approver, approvalId);
      // The approval is for level 2 and cannot be spent on level 3.
      expect(await apiStatus(execute(3))).toBe(403);
      expect(await execute()).toEqual({ from: 1, to: 2 });
      expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');

      const change = await one<{ actor_type: string; actor_id: string; direction: string }>(
        `SELECT actor_type, actor_id, direction FROM trust.verification_level_changes WHERE user_id = $1`,
        [userId],
      );
      expect(change).toEqual({ actor_type: 'KYC_ANALYST', actor_id: requester.userId, direction: 'GRANT' });
      // Spent once.
      expect(await apiStatus(execute())).toBeDefined();
    });

    it('is carried out only by the person who asked', async () => {
      const userId = await verifiedContactUser();
      const requester = await staff();
      const approver = await staff();
      const { approvalId } = await requestOverride(database.db(), {
        actor: requester,
        kind: 'LEVEL',
        userId,
        direction: 'GRANT',
        toLevel: 2,
        reason: 'r',
      });
      await approve(approver, approvalId);
      expect(
        await apiStatus(
          executeLevelOverride(database.db(), {
            actor: approver,
            approvalId,
            userId,
            direction: 'GRANT',
            toLevel: 2,
            reason: 'r',
          }),
        ),
      ).toBe(403);
      expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');
    });

    it('refuses to request a level 4 grant or a revoke below level 1', async () => {
      const userId = await identityVerifiedUser();
      const requester = await staff();
      expect(
        await apiStatus(
          requestOverride(database.db(), {
            actor: requester,
            kind: 'LEVEL',
            userId,
            direction: 'GRANT',
            toLevel: 4,
            reason: 'r',
          }),
        ),
      ).toBe(422);
      expect(
        await apiStatus(
          requestOverride(database.db(), {
            actor: requester,
            kind: 'LEVEL',
            userId,
            direction: 'REVOKE',
            toLevel: 0,
            reason: 'r',
          }),
        ),
      ).toBe(422);
    });

    it('revokes down to level 1 after approval', async () => {
      const userId = await identityVerifiedUser();
      const requester = await staff();
      const approver = await staff();
      const { approvalId } = await requestOverride(database.db(), {
        actor: requester,
        kind: 'LEVEL',
        userId,
        direction: 'REVOKE',
        toLevel: 1,
        reason: 'Document found to be forged',
      });
      await approve(approver, approvalId);
      await executeLevelOverride(database.db(), {
        actor: requester,
        approvalId,
        userId,
        direction: 'REVOKE',
        toLevel: 1,
        reason: 'Document found to be forged',
      });
      expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');
    });
  });
});
