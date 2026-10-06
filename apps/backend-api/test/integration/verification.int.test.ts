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
import { runExpireStale } from '../../src/modules/trust/jobs/expire-stale.job.js';
import { runIdentityCheck } from '../../src/modules/trust/jobs/run-identity-check.job.js';
import { runLivenessCheck } from '../../src/modules/trust/jobs/run-liveness-check.job.js';
import type { TrustJobDeps } from '../../src/modules/trust/jobs/deps.js';
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
    const { rows: accounts } = await owner.query<{ id: string }>(
      `INSERT INTO files.storage_accounts (pool, label, cloud_name, credential_env_prefix, status)
       VALUES ('TRADE_ASSET', $1, 'c', 'CLOUDINARY_TRADE_1', 'ACTIVE') RETURNING id`,
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

  it('takes a user from CONTACT_VERIFIED to IDENTITY_VERIFIED through NIN and liveness', async () => {
    const userId = await verifiedContactUser();

    await runNin(userId);
    // The identifier alone is not level 2: M6 §4 needs liveness too.
    expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');

    await runLiveness(userId);
    expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');

    const { rows } = await database
      .app()
      .query<{ from_level: number; to_level: number; direction: string }>(
        `SELECT from_level, to_level, direction FROM trust.verification_level_changes WHERE user_id = $1`,
        [userId],
      );
    expect(rows).toEqual([{ from_level: 1, to_level: 2, direction: 'GRANT' }]);
  });

  it('accepts a BVN instead of a NIN for the same level', async () => {
    const userId = await verifiedContactUser();
    const submitted = await submitIdentifierCheck(serviceDeps(), {
      userId,
      type: 'BVN',
      identifier: RAW_BVN,
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
    });
    await runIdentityCheck(jobDeps(), { requestId: submitted.requestId, sealed: submitted.job.sealed });
    await runLiveness(userId);
    expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');
  });

  it('leaves no raw identifier in any trust column, nor in the outbox', async () => {
    const userId = await verifiedContactUser();
    await runNin(userId);
    await runLiveness(userId);

    const owner = database.owner();
    const { rows: columns } = await owner.query<{ schema: string; table: string; column: string }>(
      `SELECT table_schema AS schema, table_name AS table, column_name AS column
         FROM information_schema.columns
        WHERE table_schema = 'trust'
          AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'bytea')`,
    );
    expect(columns.length).toBeGreaterThan(0);

    const hits: string[] = [];
    for (const column of columns) {
      const { rows } = await owner.query<{ n: string }>(
        `SELECT count(*) AS n FROM "${column.schema}"."${column.table}"
          WHERE "${column.column}"::text LIKE $1`,
        [`%${RAW_NIN}%`],
      );
      if (Number(rows[0]?.n ?? 0) > 0) hits.push(`${column.table}.${column.column}`);
    }
    expect(hits).toEqual([]);

    const { rows: outbox } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM platform.outbox WHERE payload::text LIKE $1 OR payload::text LIKE $2`,
      [`%${RAW_NIN}%`, `%${LAST_NAME}%`],
    );
    expect(Number(outbox[0]?.n ?? 0)).toBe(0);
  });

  it('keeps a masked value and a hash that is not the number', async () => {
    const userId = await verifiedContactUser();
    await runNin(userId);
    const { rows } = await database
      .app()
      .query<{ masked: string; hash: Buffer }>(
        `SELECT nin_masked AS masked, nin_hash AS hash FROM trust.nin_verifications WHERE user_id = $1`,
        [userId],
      );
    expect(rows[0]?.masked).toBe('*******2224');
    expect(rows[0]?.hash.toString('hex')).not.toContain(RAW_NIN);
    expect(rows[0]?.hash).toHaveLength(32);
  });

  it('holds a duplicate NIN in MANUAL_REVIEW and leaves the first user verified', async () => {
    const first = await verifiedContactUser();
    await runNin(first);
    await runLiveness(first, '1');
    expect(await levelOf(first)).toBe('IDENTITY_VERIFIED');

    const second = await verifiedContactUser();
    const requestId = await runNin(second);

    const { rows } = await database
      .app()
      .query<{ status: string }>(`SELECT status FROM trust.verification_requests WHERE id = $1`, [requestId]);
    // Neither approved nor rejected: §7 says a human decides.
    expect(rows[0]?.status).toBe('MANUAL_REVIEW');
    expect(await levelOf(second)).toBe('CONTACT_VERIFIED');
    expect(await levelOf(first)).toBe('IDENTITY_VERIFIED');

    // The second attempt did not claim the number.
    const { rows: verified } = await database
      .app()
      .query<{ n: string }>(
        `SELECT count(*) AS n FROM trust.nin_verifications WHERE verified_at IS NOT NULL`,
      );
    expect(Number(verified[0]?.n)).toBe(1);

    const { rows: events } = await database
      .app()
      .query<{ n: string }>(
        `SELECT count(*) AS n FROM platform.outbox WHERE event_type = 'trust.verification.duplicate_identity_detected'`,
      );
    expect(Number(events[0]?.n)).toBe(1);
  });

  it('treats the user re-submitting their OWN verified NIN as a no-op success', async () => {
    const userId = await verifiedContactUser();
    await runNin(userId);
    await runLiveness(userId);
    expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');

    // The submit-time guard answers first; no provider call is spent and no review case is opened.
    await expect(
      submitIdentifierCheck(serviceDeps(), {
        userId,
        type: 'NIN',
        identifier: RAW_NIN,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const { rows } = await database
      .app()
      .query<{ n: string }>(
        `SELECT count(*) AS n FROM platform.outbox WHERE event_type = 'trust.verification.duplicate_identity_detected'`,
      );
    expect(Number(rows[0]?.n)).toBe(0);
    expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');
  });

  it('never downgrades a higher level through a repeated level-2 grant', async () => {
    const userId = await verifiedContactUser();
    await runNin(userId);
    await runLiveness(userId);
    // A level T-051 will grant. A redelivered level-2 job must leave it alone and append nothing.
    await database
      .owner()
      .query(`UPDATE identity.users SET verification_level = 'BUSINESS_VERIFIED' WHERE id = $1`, [userId]);

    const outcome = await bindStore(database.db()).grantLevel({
      userId,
      toLevel: 2,
      reason: 'a redelivered job',
      actorType: 'PROVIDER_AUTO',
      provider: 'FAKE',
    });

    expect(outcome.changed).toBe(false);
    expect(await levelOf(userId)).toBe('BUSINESS_VERIFIED');
    const { rows } = await database
      .app()
      .query<{ n: string }>(`SELECT count(*) AS n FROM trust.verification_level_changes WHERE user_id = $1`, [
        userId,
      ]);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('does not let a job resurrect a request the sweep already expired', async () => {
    const userId = await verifiedContactUser();
    const submitted = await submitIdentifierCheck(serviceDeps(), {
      userId,
      type: 'NIN',
      identifier: RAW_NIN,
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
    });
    // The sweep closes it while the job is still queued.
    await database
      .owner()
      .query(`UPDATE trust.verification_requests SET status = 'EXPIRED' WHERE id = $1`, [
        submitted.requestId,
      ]);

    await runIdentityCheck(jobDeps(), { requestId: submitted.requestId, sealed: submitted.job.sealed });

    const { rows } = await database
      .app()
      .query<{ status: string }>(`SELECT status FROM trust.verification_requests WHERE id = $1`, [
        submitted.requestId,
      ]);
    expect(rows[0]?.status).toBe('EXPIRED');
    expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');
    const { rows: outcomes } = await database
      .app()
      .query<{ n: string }>(`SELECT count(*) AS n FROM trust.nin_verifications`);
    expect(Number(outcomes[0]?.n)).toBe(0);
  });

  it('refuses a second in-flight request of the same type for one user', async () => {
    const userId = await verifiedContactUser();
    await submitIdentifierCheck(serviceDeps(), {
      userId,
      type: 'NIN',
      identifier: RAW_NIN,
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
    });
    await expect(
      submitIdentifierCheck(serviceDeps(), {
        userId,
        type: 'NIN',
        identifier: RAW_NIN,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('cannot be rewritten, at either of the two layers that stop it', async () => {
    const userId = await verifiedContactUser();
    await runNin(userId);
    await runLiveness(userId);

    // The runtime role never reaches the trigger: `grantRuntimeAccess` REVOKEs UPDATE and DELETE on
    // every append-only table, so Postgres refuses on privilege (42501) first. That is the stronger
    // of the two guarantees, and it is the one the app actually runs into — this test used to assert
    // KT001 here, which asked the weaker layer to answer for the stronger one. T-032 made and fixed
    // the identical mistake against identity_audit_log; this is its resolution.
    expect(
      await sqlState(database.app().query(`UPDATE trust.verification_level_changes SET reason = 'x'`)),
    ).toBe('42501');
    expect(await sqlState(database.app().query(`DELETE FROM trust.verification_level_changes`))).toBe(
      '42501',
    );

    // The OWNER has the privilege and is stopped by the trigger instead (migration 0030).
    expect(
      await sqlState(database.owner().query(`UPDATE trust.verification_level_changes SET reason = 'x'`)),
    ).toBe('KT001');
    expect(await sqlState(database.owner().query(`DELETE FROM trust.verification_level_changes`))).toBe(
      'KT001',
    );
  });

  it('expires a request the provider never answered, and grants nothing', async () => {
    const userId = await verifiedContactUser();
    // Ends in 0: the fake accepts it and never answers.
    const requestId = await runNin(userId, '22222222220');

    await database
      .owner()
      .query(`UPDATE trust.verification_requests SET expires_at = now() - interval '1 hour'`);
    const result = await runExpireStale(jobDeps(), new Date());

    expect(result.expired).toBe(1);
    const { rows } = await database
      .app()
      .query<{ status: string }>(`SELECT status FROM trust.verification_requests WHERE id = $1`, [requestId]);
    expect(rows[0]?.status).toBe('EXPIRED');
    expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');
  });

  it('does not expire a request waiting on a human', async () => {
    const userId = await verifiedContactUser();
    // Ends in 2: LOW_CONFIDENCE, which parks in MANUAL_REVIEW.
    const requestId = await runNin(userId, '22222222222');
    await database
      .owner()
      .query(`UPDATE trust.verification_requests SET expires_at = now() - interval '1 hour'`);

    expect((await runExpireStale(jobDeps(), new Date())).expired).toBe(0);
    const { rows } = await database
      .app()
      .query<{ status: string }>(`SELECT status FROM trust.verification_requests WHERE id = $1`, [requestId]);
    expect(rows[0]?.status).toBe('MANUAL_REVIEW');
  });

  it('writes a provider-call row for every call, which is the only record of what was spent', async () => {
    const userId = await verifiedContactUser();
    await runNin(userId);
    await runLiveness(userId);
    const { rows } = await database
      .app()
      .query<{ call_type: string; provider: string; succeeded: boolean }>(
        `SELECT call_type, provider, succeeded FROM trust.kyc_provider_calls ORDER BY id`,
      );
    expect(rows).toEqual([
      { call_type: 'NIN', provider: 'FAKE', succeeded: true },
      { call_type: 'LIVENESS', provider: 'FAKE', succeeded: true },
    ]);
  });

  it('reports the level and what is still outstanding', async () => {
    const userId = await verifiedContactUser();
    await runNin(userId);
    const status = await readVerificationStatus(serviceDeps(), userId);
    expect(status).toMatchObject({
      level: 'CONTACT_VERIFIED',
      levelNumber: 1,
      requirements: { identifier: true, liveness: false },
      inFlight: [],
    });
  });

  it('refuses a liveness selfie uploaded by somebody else with a 404', async () => {
    const mine = await verifiedContactUser();
    const theirs = await verifiedContactUser();
    await runNin(mine);
    const selfie = await kycSelfie(theirs, '2');
    await expect(
      submitLivenessCheck(serviceDeps(), { userId: mine, selfieFileId: selfie }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects terminally when the provider finds no record', async () => {
    const userId = await verifiedContactUser();
    // Ends in 1: the fake's "no match".
    const requestId = await runNin(userId, '22222222221');
    const { rows } = await database
      .app()
      .query<{ status: string; reason: string | null }>(
        `SELECT status, rejection_reason AS reason FROM trust.verification_requests WHERE id = $1`,
        [requestId],
      );
    expect(rows[0]?.status).toBe('REJECTED');
    expect(rows[0]?.reason).toBeTruthy();
    expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');
  });
});
