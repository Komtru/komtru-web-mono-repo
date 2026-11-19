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
import { runIdentityCheck } from '../../src/modules/trust/jobs/run-identity-check.job.js';
import { runLivenessCheck } from '../../src/modules/trust/jobs/run-liveness-check.job.js';
import { runBusinessCheck } from '../../src/modules/trust/jobs/run-business-check.job.js';
import type { TrustJobDeps } from '../../src/modules/trust/jobs/deps.js';
import { submitBusinessCheck } from '../../src/modules/trust/services/business.service.js';

import { submitAddressCheck } from '../../src/modules/trust/services/address.service.js';
import {
  submitIdentifierCheck,
  submitLivenessCheck,
} from '../../src/modules/trust/services/verification.service.js';
import type { VerificationDeps } from '../../src/modules/trust/services/verification.service.js';
import { infraEnabled } from '../support/db-urls.js';
import { useTestDatabase } from '../support/db.js';
import { insertUser } from '../modules/notify/support.js';
import { grantRole, seedUser } from '../modules/identity/support.js';
import { publishRejected, parkForReview } from '../../src/modules/trust/infrastructure/postgres/review.js';
import { scrubErasedAccountFlags } from '../../src/modules/trust/infrastructure/postgres/erasure.js';
import { verificationRequests } from '../../src/modules/trust/infrastructure/postgres/schema/requests.js';
import { registerCase } from '../../src/modules/cases/index.js';
import { reassignCase } from '../../src/modules/cases/services/case.service.js';
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
    allowNameOverride: true,
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

  // --- review fixes (T-052 review items 1-11) ----------------------------------------------------

  describe('repeated rejections under concurrency', () => {
    /** Inserts a REJECTED request for `userId` and publishes through the real function, in one transaction. */
    const rejectInTx = async (userId: string, gate: () => Promise<void>): Promise<void> => {
      await database.db().transaction(async (tx) => {
        const [row] = await tx
          .insert(verificationRequests)
          .values({
            userId,
            verificationType: 'NIN',
            status: 'REJECTED',
            targetLevel: 2,
            attemptCount: 1,
            decidedAt: new Date(),
            rejectionReason: 'IDENTIFIER_NOT_FOUND',
            expiresAt: new Date(Date.now() + 86_400_000),
          })
          .returning({ id: verificationRequests.id });
        // Both rows are written, neither is committed: this is where an unlocked counter goes blind.
        await gate();
        await publishRejected(tx, {
          payload: {
            requestId: row?.id ?? '',
            userId,
            type: 'NIN',
            reason: 'IDENTIFIER_NOT_FOUND',
            attemptCount: 1,
          },
          aggregateType: 'verification_request',
          aggregateId: row?.id ?? '',
        });
      });
    };

    const barrier = (parties: number): (() => Promise<void>) => {
      let waiting = 0;
      let release!: () => void;
      const opened = new Promise<void>((resolve) => (release = resolve));
      return async () => {
        waiting += 1;
        if (waiting === parties) release();
        await opened;
      };
    };

    it('fires exactly once when the second and the "first" rejection commit together', async () => {
      const userId = await verifiedContactUser();
      const gate = barrier(2);
      await Promise.all([rejectInTx(userId, gate), rejectInTx(userId, gate)]);
      expect(await eventCount('trust.verification.rejected')).toBe(2);
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(1);
    });

    it('fires exactly once when a second rejection races a third-party first, and a later third stays quiet', async () => {
      const userId = await verifiedContactUser();
      await rejectInTx(userId, () => Promise.resolve());
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(0);
      await rejectInTx(userId, () => Promise.resolve());
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(1);
      await rejectInTx(userId, () => Promise.resolve());
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(1);
    });

    it('does not count another user, and counts a rejection exactly at the window edge', async () => {
      const userId = await verifiedContactUser();
      const other = await verifiedContactUser();
      await rejectInTx(other, () => Promise.resolve());
      await rejectInTx(userId, () => Promise.resolve());
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(0);
      // 29 days old is inside the window.
      await owner().query(
        `UPDATE trust.verification_requests SET decided_at = now() - interval '29 days' WHERE user_id = $1`,
        [userId],
      );
      await rejectInTx(userId, () => Promise.resolve());
      expect(await eventCount('trust.verification.repeated_rejection')).toBe(1);
    });
  });

  describe('parking is idempotent', () => {
    it('a redelivered job leaves one case, one flag and one detection event', async () => {
      await identityVerifiedUser('1', RAW_NIN);
      const second = await verifiedContactUser();
      const submitted = await submitIdentifierCheck(serviceDeps(), {
        userId: second,
        type: 'NIN',
        identifier: RAW_NIN,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
      });
      const job = { requestId: submitted.requestId, sealed: submitted.job.sealed };
      await runIdentityCheck(jobDeps(), job);
      await runIdentityCheck(jobDeps(), job);

      expect(await caseFor(submitted.requestId)).toHaveLength(1);
      expect(
        Number((await one<{ n: string }>(`SELECT count(*) AS n FROM trust.duplicate_identity_flags`)).n),
      ).toBe(1);
      expect(await eventCount('trust.verification.duplicate_identity_detected')).toBe(1);
    });

    it('parkForReview twice writes one case and one flag', async () => {
      const first = await identityVerifiedUser('1', RAW_NIN);
      const second = await verifiedContactUser();
      const requestId = await runNin(second);
      const subject = {
        id: requestId,
        userId: second,
        verificationType: 'NIN' as const,
        attemptCount: 1,
      };
      const flag = await one<{ identifier_hash: Buffer }>(
        `SELECT identifier_hash FROM trust.duplicate_identity_flags`,
      );
      await database
        .db()
        .transaction((tx) =>
          parkForReview(tx, subject, { identifierHash: flag.identifier_hash, firstUserId: first }),
        );
      expect(await caseFor(requestId)).toHaveLength(1);
      expect(
        Number((await one<{ n: string }>(`SELECT count(*) AS n FROM trust.duplicate_identity_flags`)).n),
      ).toBe(1);
    });

    it('a duplicate whose first owner is unknown cannot be decided from the plain queue', async () => {
      const userId = await verifiedContactUser();
      // A request parked as a duplicate whose first owner could not be read back: a case, but no flag.
      const { id: requestId } = await one<{ id: string }>(
        `INSERT INTO trust.verification_requests
           (user_id, verification_type, status, target_level, attempt_count, expires_at)
         VALUES ($1, 'NIN', 'MANUAL_REVIEW', 2, 1, now() + interval '1 day') RETURNING id`,
        [userId],
      );
      await database
        .db()
        .transaction((tx) =>
          parkForReview(
            tx,
            { id: requestId, userId, verificationType: 'NIN', attemptCount: 1 },
            { identifierHash: Buffer.from('aa', 'hex'), firstUserId: null },
          ),
        );
      expect(
        Number((await one<{ n: string }>(`SELECT count(*) AS n FROM trust.duplicate_identity_flags`)).n),
      ).toBe(0);
      expect((await caseFor(requestId))[0]?.facts).toMatchObject({ duplicateIdentity: true });

      const analyst = await staff();
      await assignReview(database.db(), { actor: analyst, requestId });
      expect(
        await apiStatus(
          decideReview(database.db(), { actor: analyst, requestId, outcome: 'APPROVE', reason: 'fine' }),
        ),
      ).toBe(409);
      expect(await requestStatus(requestId)).toBe('MANUAL_REVIEW');
    });
  });

  describe('the queue list', () => {
    it('counts with the same joins as it lists', async () => {
      const userId = await verifiedContactUser();
      await runNin(userId, '22222222222');
      // A case whose request no longer exists appears in neither items nor total.
      await database.db().transaction((tx) =>
        registerCase(tx, {
          type: 'IDENTITY',
          subjectType: 'verification_request',
          subjectId: randomUUID(),
          title: 'orphan',
          facts: {},
        }),
      );
      const list = await listKycQueue(database.db(), { page: 1, limit: 10 });
      expect(list.items).toHaveLength(1);
      expect(list.total).toBe(1);
    });
  });

  describe('clearing a duplicate: approval handling and escalation', () => {
    const pair = async (nin: string, suffix: string) => {
      const first = await identityVerifiedUser(suffix, nin);
      const second = await verifiedContactUser();
      const requestId = await runNin(second, nin);
      const flag = await one<{ id: string }>(
        `SELECT id FROM trust.duplicate_identity_flags WHERE request_id = $1`,
        [requestId],
      );
      return { first, second, requestId, flagId: flag.id };
    };
    const approvalFor = async (requester: { userId: string; roles: readonly string[] }, flagId: string) =>
      (
        await requestOverride(database.db(), {
          actor: requester,
          kind: 'CLEAR_DUPLICATE',
          flagId,
          reason: 'The first account was abandoned',
        })
      ).approvalId;
    const approve = (approver: { userId: string; roles: readonly string[] }, approvalId: string) =>
      decideApproval(
        { db: database.db() },
        { actor: approver, approvalId, decision: 'APPROVE', reason: 'Agreed' },
      );
    const clear = (actor: { userId: string; roles: readonly string[] }, flagId: string, approvalId: string) =>
      resolveDuplicateFlag(database.db(), {
        actor,
        flagId,
        resolution: 'CLEARED_FALSE_POSITIVE',
        notes: 'Same person',
        approvalId,
      });
    const untouched = async (requestId: string, first: string) => {
      expect(await requestStatus(requestId)).toBe('MANUAL_REVIEW');
      expect(
        (await one<{ status: string }>(`SELECT status FROM trust.duplicate_identity_flags`)).status,
      ).toBe('OPEN');
      expect(await decisions(requestId)).toEqual([]);
      expect((await caseFor(requestId))[0]?.state).not.toBe('DECIDED');
      expect(await levelOf(first)).toBe('IDENTITY_VERIFIED');
      expect(await eventCount('trust.verification.duplicate_flag_resolved')).toBe(0);
    };

    it('refuses an approval already spent, and changes nothing', async () => {
      const { first, requestId, flagId } = await pair(RAW_NIN, '1');
      const requester = await staff();
      await assignReview(database.db(), { actor: requester, requestId });
      const approvalId = await approvalFor(requester, flagId);
      await approve(await staff(), approvalId);
      await owner().query(`UPDATE identity.admin_action_approvals SET executed_at = now() WHERE id = $1`, [
        approvalId,
      ]);
      expect(await apiStatus(clear(requester, flagId, approvalId))).toBe(409);
      await untouched(requestId, first);
    });

    it('refuses an expired approval, and changes nothing', async () => {
      const { first, requestId, flagId } = await pair(RAW_NIN, '1');
      const requester = await staff();
      await assignReview(database.db(), { actor: requester, requestId });
      const approvalId = await approvalFor(requester, flagId);
      await approve(await staff(), approvalId);
      await owner().query(
        `UPDATE identity.admin_action_approvals SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [approvalId],
      );
      expect(await apiStatus(clear(requester, flagId, approvalId))).toBe(409);
      await untouched(requestId, first);
    });

    it('refuses an approval whose payload names another flag, and changes nothing', async () => {
      const { first, requestId, flagId } = await pair(RAW_NIN, '1');
      const requester = await staff();
      await assignReview(database.db(), { actor: requester, requestId });
      const approvalId = await approvalFor(requester, flagId);
      await approve(await staff(), approvalId);
      await owner().query(
        `UPDATE identity.admin_action_approvals SET payload = jsonb_set(payload, '{flagId}', to_jsonb($2::text))
          WHERE id = $1`,
        [approvalId, randomUUID()],
      );
      expect(await apiStatus(clear(requester, flagId, approvalId))).toBe(403);
      await untouched(requestId, first);
    });

    it('refuses an approval for flag A used on flag B, and the approval then still serves A', async () => {
      const a = await pair(RAW_NIN, '1');
      const b = await pair('22222222225', '3');
      const requester = await staff();
      await assignReview(database.db(), { actor: requester, requestId: a.requestId });
      await assignReview(database.db(), { actor: requester, requestId: b.requestId });
      const approvalA = await approvalFor(requester, a.flagId);
      await approve(await staff(), approvalA);

      expect([403, 404]).toContain(await apiStatus(clear(requester, b.flagId, approvalA)));
      expect(await requestStatus(b.requestId)).toBe('MANUAL_REVIEW');
      expect(await levelOf(b.first)).toBe('IDENTITY_VERIFIED');

      // Not burned by the refusal: it clears the flag it was signed for, once.
      expect((await clear(requester, a.flagId, approvalA)).status).toBe('CLEARED_FALSE_POSITIVE');
      expect(await apiStatus(clear(requester, b.flagId, approvalA))).toBeDefined();
      expect(await requestStatus(b.requestId)).toBe('MANUAL_REVIEW');
    });

    it('leaves a still-open flag clearable after the erasure scrub removed its hash', async () => {
      const { first, second, requestId, flagId } = await pair(RAW_NIN, '1');
      await database.db().transaction((tx) => scrubErasedAccountFlags(tx, first));
      const scrubbed = await one<{ len: number; notes: string | null }>(
        `SELECT length(identifier_hash) AS len, resolution_notes AS notes FROM trust.duplicate_identity_flags`,
      );
      expect(scrubbed).toEqual({ len: 0, notes: null });
      // Redelivery changes nothing and does not throw.
      await database.db().transaction((tx) => scrubErasedAccountFlags(tx, first));

      const requester = await staff();
      await assignReview(database.db(), { actor: requester, requestId });
      const approvalId = await approvalFor(requester, flagId);
      await approve(await staff(), approvalId);
      expect((await clear(requester, flagId, approvalId)).status).toBe('CLEARED_FALSE_POSITIVE');
      const { rows } = await owner().query<{ user_id: string }>(
        `SELECT user_id FROM trust.nin_verifications WHERE verified_at IS NOT NULL`,
      );
      expect(rows.map((r) => r.user_id)).toEqual([second]);
    });

    it('does not let whoever escalated a flag resolve it, unless senior, and lets a reassigned reviewer', async () => {
      const { requestId, flagId } = await pair(RAW_NIN, '1');
      const escalator = await staff();
      await assignReview(database.db(), { actor: escalator, requestId });
      await resolveDuplicateFlag(database.db(), {
        actor: escalator,
        flagId,
        resolution: 'ESCALATED',
        notes: 'Needs a senior look',
      });
      const confirm = (actor: { userId: string; roles: readonly string[] }) =>
        resolveDuplicateFlag(database.db(), {
          actor,
          flagId,
          resolution: 'CONFIRMED_DUPLICATE',
          notes: 'Different people',
        });
      expect(await apiStatus(confirm(escalator))).toBe(403);
      expect(await requestStatus(requestId)).toBe('MANUAL_REVIEW');

      // A reviewer who has not been given the case cannot decide it either.
      const other = await staff();
      await grantRole(owner(), other.userId, 'SUPER_ADMIN', ['cases.manage']);
      expect(await apiStatus(confirm(other))).toBeDefined();
      expect(await requestStatus(requestId)).toBe('MANUAL_REVIEW');

      const found = (await caseFor(requestId))[0];
      await reassignCase(database.db(), {
        actor: escalator,
        caseId: found?.id ?? '',
        toUserId: other.userId,
        reason: 'Handing to the senior reviewer',
      });
      expect((await confirm(other)).status).toBe('CONFIRMED_DUPLICATE');
      expect(await requestStatus(requestId)).toBe('REJECTED');
    });

    it('lets a senior role who escalated a flag resolve it', async () => {
      const { requestId, flagId } = await pair(RAW_NIN, '1');
      const { userId } = await seedUser(database.owner());
      const senior = { userId, roles: ['SUPER_ADMIN'] as const };
      await assignReview(database.db(), { actor: senior, requestId });
      await resolveDuplicateFlag(database.db(), {
        actor: senior,
        flagId,
        resolution: 'ESCALATED',
        notes: 'Looking myself',
      });
      const resolved = await resolveDuplicateFlag(database.db(), {
        actor: senior,
        flagId,
        resolution: 'CONFIRMED_DUPLICATE',
        notes: 'Different people',
      });
      expect(resolved.status).toBe('CONFIRMED_DUPLICATE');
    });

    it('clearing a CAC duplicate releases the registration and leaves the first account its identity level', async () => {
      const first = await identityVerifiedUser('1', RAW_NIN);
      await runBusiness(first);
      const second = await identityVerifiedUser('2', '22222222225');
      const requestId = await runBusiness(second, RC_NUMBER);
      const flag = await one<{ id: string }>(`SELECT id FROM trust.duplicate_identity_flags`);
      const requester = await staff();
      await assignReview(database.db(), { actor: requester, requestId });
      const approvalId = await approvalFor(requester, flag.id);
      await approve(await staff(), approvalId);
      await clear(requester, flag.id, approvalId);

      const { rows } = await owner().query<{ user_id: string }>(
        `SELECT user_id FROM trust.business_verifications WHERE verified_at IS NOT NULL`,
      );
      expect(rows.map((r) => r.user_id)).toEqual([second]);
      // Level 3 rested on the registration; the NIN and liveness behind level 2 are untouched.
      expect(await levelOf(first)).toBe('IDENTITY_VERIFIED');
    });
  });

  describe('override payloads', () => {
    it('names the user in a LEVEL override, so the approval cannot be re-aimed', async () => {
      const userId = await verifiedContactUser();
      const requester = await staff();
      const { approvalId } = await requestOverride(database.db(), {
        actor: requester,
        kind: 'LEVEL',
        userId,
        direction: 'GRANT',
        toLevel: 2,
        reason: 'In person',
      });
      const row = await one<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM identity.admin_action_approvals WHERE id = $1`,
        [approvalId],
      );
      expect(row.payload).toEqual({ kind: 'LEVEL', userId, direction: 'GRANT', toLevel: 2 });
    });
  });
});
