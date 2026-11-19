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

  it('creates every T-051 table, index and enum the migration is supposed to add', async () => {
    const owner = database.owner();
    const { rows: tables } = await owner.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'trust' ORDER BY table_name`,
    );
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'address_checks',
        'bank_account_name_matches',
        'business_verifications',
        'social_proof_claims',
        'verification_documents',
      ]),
    );

    // The partial unique indexes are the point of the migration: every concurrency-sensitive
    // invariant in this ticket is enforced here rather than by a check-then-insert in a service.
    const { rows: indexes } = await owner.query<{ name: string; def: string }>(
      `SELECT indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'trust'`,
    );
    const byName = new Map(indexes.map((i) => [i.name, i.def]));
    expect(byName.get('business_verifications_user_active_unique')).toMatch(
      /UNIQUE.*\(user_id\).*WHERE \(verified_at IS NOT NULL\)/s,
    );
    expect(byName.get('social_proof_claims_user_platform')).toMatch(/UNIQUE.*WHERE \(verified/s);
    expect(byName.get('social_proof_claims_platform_handle')).toMatch(/UNIQUE.*WHERE \(verified/s);

    const { rows: enums } = await owner.query<{ name: string }>(
      `SELECT t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'trust' AND t.typtype = 'e'`,
    );
    expect(enums.map((e) => e.name)).toEqual(
      expect.arrayContaining([
        'address_method',
        'bank_match_result',
        'social_proof_platform',
        'verification_document_type',
      ]),
    );
  });

  /** Cross-module references stay soft (§6.2's note); same-schema ones are real FKs. */
  it('keeps the M20 document references soft and the request references hard', async () => {
    const { rows } = await database.owner().query<{ table: string; column: string; target: string }>(
      `SELECT c.relname AS table, a.attname AS column, tc.relname AS target
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_class tc ON tc.oid = k.confrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN unnest(k.conkey) AS ck(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ck.attnum
        WHERE k.contype = 'f' AND n.nspname = 'trust'`,
    );
    // Every FK in the schema points at verification_requests, and nothing points out of `trust`.
    expect(rows.every((row) => row.target === 'verification_requests')).toBe(true);
    // `document_ref` and `storage_ref` are M20 file ids and carry no FK at all.
    expect(rows.map((row) => row.column)).not.toContain('document_ref');
    expect(rows.map((row) => row.column)).not.toContain('storage_ref');
  });

  it('takes a user from IDENTITY_VERIFIED to BUSINESS_VERIFIED through CAC and a bank match', async () => {
    const userId = await identityVerifiedUser();
    expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');

    await runBusiness(userId);
    // A verified CAC alone is not level 3: §4 wants the bank match too.
    expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');

    await runBankMatch(userId);
    expect(await levelOf(userId)).toBe('BUSINESS_VERIFIED');

    const { rows } = await database.app().query<{ from_level: number; to_level: number; direction: string }>(
      `SELECT from_level, to_level, direction FROM trust.verification_level_changes
          WHERE user_id = $1 ORDER BY occurred_at`,
      [userId],
    );
    expect(rows).toEqual([
      { from_level: 1, to_level: 2, direction: 'GRANT' },
      { from_level: 2, to_level: 3, direction: 'GRANT' },
    ]);
  });

  it('refuses a CAC submission from a user who is not identity-verified yet', async () => {
    const userId = await verifiedContactUser();
    await expect(
      submitBusinessCheck(serviceDeps(), {
        userId,
        rcNumber: RC_NUMBER,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'IDENTITY_VERIFICATION_REQUIRED' });
  });

  it('refuses a bank name-match before there is a registered name to match against', async () => {
    const userId = await identityVerifiedUser();
    await expect(
      submitBankMatchCheck(serviceDeps(), { userId, accountNumber: RAW_ACCOUNT, bankCode: BANK_CODE }),
    ).rejects.toMatchObject({ status: 409, code: 'BUSINESS_VERIFICATION_REQUIRED' });
  });

  it('stores the CAC number plainly and the submitter’s name nowhere', async () => {
    const userId = await identityVerifiedUser();
    await runBusiness(userId);
    const { rows } = await database
      .app()
      .query<{ rc: string; name: string; status: string | null; officers: boolean | null }>(
        `SELECT cac_rc_number AS rc, registered_business_name AS name, cac_status AS status,
                officers_match AS officers
           FROM trust.business_verifications WHERE user_id = $1`,
        [userId],
      );
    expect(rows[0]).toMatchObject({
      rc: RC_NUMBER,
      name: RC_BUSINESS_NAME,
      status: 'active',
      officers: true,
    });

    // The names travel to the provider for the officer check and are persisted nowhere (§6.5).
    const owner = database.owner();
    for (const needle of [FIRST_NAME, LAST_NAME]) {
      const { rows: hits } = await owner.query<{ count: string }>(
        `SELECT count(*) AS count FROM trust.business_verifications
          WHERE registered_business_name ILIKE '%' || $1 || '%' OR cac_rc_number ILIKE '%' || $1 || '%'`,
        [needle],
      );
      expect(hits[0]?.count).toBe('0');
    }
  });

  it('leaves no full bank account number in any trust column, nor in the outbox', async () => {
    const userId = await identityVerifiedUser();
    await runBusiness(userId);
    await runBankMatch(userId);

    const owner = database.owner();
    const { rows: columns } = await owner.query<{ schema: string; table: string; column: string }>(
      `SELECT table_schema AS schema, table_name AS table, column_name AS column
         FROM information_schema.columns
        WHERE table_schema = 'trust' AND data_type IN ('text', 'character varying', 'jsonb')`,
    );
    for (const column of columns) {
      const { rows } = await owner.query<{ count: string }>(
        `SELECT count(*) AS count FROM ${column.schema}."${column.table}"
          WHERE "${column.column}"::text LIKE '%' || $1 || '%'`,
        [RAW_ACCOUNT],
      );
      expect(rows[0]?.count, `${column.table}.${column.column} holds the raw account number`).toBe('0');
    }
    const { rows: outbox } = await owner.query<{ count: string }>(
      `SELECT count(*) AS count FROM platform.outbox WHERE payload::text LIKE '%' || $1 || '%'`,
      [RAW_ACCOUNT],
    );
    expect(outbox[0]?.count).toBe('0');

    const { rows: masked } = await owner.query<{ masked: string }>(
      `SELECT account_number_masked AS masked FROM trust.bank_account_name_matches WHERE user_id = $1`,
      [userId],
    );
    expect(masked[0]?.masked).toBe('******6787');
  });

  /** T-073's read, which is why this check exists as a named export at all. */
  it('answers T-073 with the name-match on record for a payout account', async () => {
    const userId = await identityVerifiedUser();
    await runBusiness(userId);
    await runBankMatch(userId);

    const store = bindStore(database.db());
    const match = await readBankNameMatch(store, hasher, {
      userId,
      bankCode: BANK_CODE,
      accountNumber: RAW_ACCOUNT,
    });
    expect(match).toMatchObject({
      matchResult: 'EXACT',
      resolvedAccountName: RC_BUSINESS_NAME,
      expectedName: RC_BUSINESS_NAME,
    });

    // A different account on the same user is not this account's verdict.
    expect(
      await readBankNameMatch(store, hasher, { userId, bankCode: BANK_CODE, accountNumber: '0123456780' }),
    ).toBeUndefined();
    // Nor is another account at the same bank that merely shares its last four digits.
    expect(
      await readBankNameMatch(store, hasher, { userId, bankCode: BANK_CODE, accountNumber: '9999996787' }),
    ).toBeUndefined();
  });

  /**
   * `FUZZY_MATCH` is not a pass. The account ending in 2 resolves to an abbreviated variant of the
   * registered name, which is "almost certainly the same business" — and that is not the standard
   * for the check that decides where money leaves the platform to.
   */
  it('parks a near-miss bank name in MANUAL_REVIEW and grants no level', async () => {
    const userId = await identityVerifiedUser();
    await runBusiness(userId);
    const requestId = await runBankMatch(userId, '0123456782');

    const { rows } = await database.app().query<{ status: string; result: string; reason: string | null }>(
      `SELECT r.status, m.match_result AS result, r.rejection_reason AS reason
           FROM trust.verification_requests r
           JOIN trust.bank_account_name_matches m ON m.request_id = r.id
          WHERE r.id = $1`,
      [requestId],
    );
    expect(rows[0]).toMatchObject({ status: 'MANUAL_REVIEW', result: 'FUZZY_MATCH' });
    expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');
  });

  it('refuses a second verified business on one account, at the database', async () => {
    const userId = await identityVerifiedUser();
    await runBusiness(userId);
    // The service refuses before a provider call is spent.
    await expect(
      submitBusinessCheck(serviceDeps(), {
        userId,
        rcNumber: '1487337',
      }),
    ).rejects.toMatchObject({ status: 409 });

    // And the index refuses it even if the service were bypassed.
    await expect(
      database.app().query(
        `INSERT INTO trust.business_verifications
             (request_id, user_id, cac_rc_number, registered_business_name, provider,
              provider_reference, verified_at)
           SELECT id, $1, '9999999', 'OTHER LTD', 'FAKE', 'ref', now()
             FROM trust.verification_requests WHERE user_id = $1 LIMIT 1`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  /**
   * §7's CAC branch: real registration, already somebody else's verified business. Neither approved
   * nor rejected — rejecting would hand a fraudster a veto over a real company's RC number.
   */
  it('parks a CAC registration another account already holds, and leaves that account alone', async () => {
    const first = await identityVerifiedUser('1', RAW_NIN);
    await runBusiness(first);
    await runBankMatch(first);
    expect(await levelOf(first)).toBe('BUSINESS_VERIFIED');

    const second = await identityVerifiedUser('2', '22222222225');
    const requestId = await runBusiness(second, RC_NUMBER);

    const { rows } = await database.app().query<{ status: string; verified: Date | null }>(
      `SELECT r.status, b.verified_at AS verified
           FROM trust.verification_requests r
           JOIN trust.business_verifications b ON b.request_id = r.id
          WHERE r.id = $1`,
      [requestId],
    );
    // No verified_at: the registration stays unclaimed, so the real company is not locked out.
    expect(rows[0]).toMatchObject({ status: 'MANUAL_REVIEW', verified: null });
    expect(await levelOf(second)).toBe('IDENTITY_VERIFIED');
    expect(await levelOf(first)).toBe('BUSINESS_VERIFIED');

    const { rows: events } = await database
      .owner()
      .query<{ name: string; payload: { identifierType: string; identifierHashHex: string } }>(
        `SELECT event_type AS name, payload FROM platform.outbox
          WHERE event_type = 'trust.verification.duplicate_identity_detected'`,
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.identifierType).toBe('CAC');
    // Hashed, even though an RC number is public: one shape behind `identifierHashHex`, always.
    expect(events[0]?.payload.identifierHashHex).not.toContain(RC_NUMBER);
  });

  it('writes the address request, the check and the document in one transaction', async () => {
    const userId = await identityVerifiedUser();
    const fileId = await kycSelfie(userId, '2');
    const submitted = await submitAddressCheck(serviceDeps(), {
      userId,
      addressLine1: '1 Allen Avenue',
      city: 'Ikeja',
      state: 'Lagos',
      method: 'UTILITY_BILL',
      documentFileId: fileId,
    });

    // MANUAL_REVIEW from the start: no provider is ever called, so a SUBMITTED row would just be
    // swept within the day and the user told their proof "timed out".
    expect(submitted.status).toBe('MANUAL_REVIEW');

    const { rows } = await database
      .app()
      .query<{ method: string; passed: boolean | null; doc: string | null; doc_type: string }>(
        `SELECT a.method, a.passed, a.document_ref AS doc, d.document_type AS doc_type
           FROM trust.address_checks a
           JOIN trust.verification_documents d ON d.request_id = a.request_id
          WHERE a.request_id = $1`,
        [submitted.requestId],
      );
    expect(rows[0]).toMatchObject({
      method: 'UTILITY_BILL',
      // Null means nobody has decided yet, which is this column's normal state until T-052.
      passed: null,
      doc: fileId,
      doc_type: 'UTILITY_BILL',
    });
  });

  it('refuses a proof of address document uploaded by somebody else, with a 404', async () => {
    const mine = await identityVerifiedUser('1');
    const theirs = await verifiedContactUser();
    const fileId = await kycSelfie(theirs, '2');
    await expect(
      submitAddressCheck(serviceDeps(), {
        userId: mine,
        addressLine1: '1 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        method: 'UTILITY_BILL',
        documentFileId: fileId,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  /** An address check contributes evidence to level 4; §4 says nothing grants it, and nothing does. */
  it('grants no level for a proof of address', async () => {
    const userId = await identityVerifiedUser();
    await submitAddressCheck(serviceDeps(), {
      userId,
      addressLine1: '1 Allen Avenue',
      city: 'Ikeja',
      state: 'Lagos',
      method: 'BANK_STATEMENT',
      documentFileId: await kycSelfie(userId, '2'),
    });
    expect(await levelOf(userId)).toBe('IDENTITY_VERIFIED');
  });

  const socialDeps = () => ({ store: bindStore(database.db()), logger });
  const socialJobDeps = () => ({
    store: bindStore(database.db()),
    social: createFakeSocialClient(),
    gateway: jobDeps().gateway,
    logger,
  });

  it('verifies a handle whose profile shows the challenge code', async () => {
    const userId = await verifiedContactUser();
    const claim = await claimSocialHandle(socialDeps(), {
      userId,
      platform: 'INSTAGRAM',
      handle: '@TechEdge_NG',
    });
    expect(claim.handle).toBe('techedge_ng');

    const requested = await requestSocialProofCheck(socialDeps(), { userId, claimId: claim.claimId });
    await runSocialProofCheck(socialJobDeps(), requested.job);

    const { rows } = await database
      .app()
      .query<{ verified: boolean; verified_at: Date | null; last: Date | null }>(
        `SELECT verified, verified_at, last_checked_at AS last FROM trust.social_proof_claims
          WHERE id = $1`,
        [claim.claimId],
      );
    expect(rows[0]?.verified).toBe(true);
    expect(rows[0]?.verified_at).not.toBeNull();
    expect(rows[0]?.last).not.toBeNull();
    // No level moves for social proof: §4 has no room for it, and the output is a profile badge.
    expect(await levelOf(userId)).toBe('CONTACT_VERIFIED');
  });

  it('moves last_checked_at even when the code was not found, so a re-check is rate-limited', async () => {
    const userId = await verifiedContactUser();
    // Ends in `y`: the fake's "handle exists, no code up".
    const claim = await claimSocialHandle(socialDeps(), { userId, platform: 'X', handle: 'techedgey' });
    const requested = await requestSocialProofCheck(socialDeps(), { userId, claimId: claim.claimId });
    await runSocialProofCheck(socialJobDeps(), requested.job);

    const { rows } = await database
      .app()
      .query<{ verified: boolean; last: Date | null }>(
        `SELECT verified, last_checked_at AS last FROM trust.social_proof_claims WHERE id = $1`,
        [claim.claimId],
      );
    expect(rows[0]).toMatchObject({ verified: false });
    expect(rows[0]?.last).not.toBeNull();

    await expect(
      requestSocialProofCheck(socialDeps(), { userId, claimId: claim.claimId }),
    ).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });

  it('refuses a handle already verified on another account, at the database', async () => {
    const first = await verifiedContactUser();
    const claim = await claimSocialHandle(socialDeps(), {
      userId: first,
      platform: 'INSTAGRAM',
      handle: 'techedge_ng',
    });
    const requested = await requestSocialProofCheck(socialDeps(), {
      userId: first,
      claimId: claim.claimId,
    });
    await runSocialProofCheck(socialJobDeps(), requested.job);

    const second = await verifiedContactUser();
    await expect(
      claimSocialHandle(socialDeps(), { userId: second, platform: 'INSTAGRAM', handle: 'techedge_ng' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  /** Partial on `verified = true`: the first thing anyone does after mistyping a handle is retype it. */
  it('lets a user abandon an unverified claim and make another, and pages the result', async () => {
    const userId = await verifiedContactUser();
    await claimSocialHandle(socialDeps(), { userId, platform: 'INSTAGRAM', handle: 'techedg' });
    await claimSocialHandle(socialDeps(), { userId, platform: 'INSTAGRAM', handle: 'techedge_ng' });

    const page = await listSocialProof(socialDeps(), { userId, page: 1, limit: 1 });
    expect(page).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(page.items).toHaveLength(1);
  });

  /**
   * `PROVIDER_UNAVAILABLE`, which nothing used to write — so an expired request carried no reason at
   * all and VF1 had nothing to render after the one failure that is not the user's fault.
   */
  it('gives an expired request a rejection code the status endpoint can describe', async () => {
    const userId = await verifiedContactUser();
    // Ends in 0: the fake stalls, leaving the request PROVIDER_PENDING for the sweep.
    await runNin(userId, '22222222220');
    await database
      .owner()
      .query(`UPDATE trust.verification_requests SET expires_at = now() - interval '1 hour'`);
    await runExpireStale(jobDeps(), new Date());

    const status = await readVerificationStatus({ store: bindStore(database.db()) }, userId);
    expect(status.rejections).toHaveLength(1);
    expect(status.rejections[0]?.type).toBe('NIN');
    expect(status.rejections[0]?.reason).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      surface: 'VF1',
      // The one copy on VF1 that asks the user to do the same thing again rather than change
      // something, because this failure is not theirs.
      remedy: 'RESUBMIT',
      identityLevelAffected: false,
    });
  });

  it('reports one structured rejection per check, which is what VF1 and BVR1 render', async () => {
    const userId = await identityVerifiedUser();
    // Ends in 1: the fake's "no such registration".
    await runBusiness(userId, '1487321');

    const status = await readVerificationStatus({ store: bindStore(database.db()) }, userId);
    expect(status.requirements).toMatchObject({
      identifier: true,
      liveness: true,
      business: false,
      businessBankAccount: false,
    });
    const cac = status.rejections.find((rejection) => rejection.type === 'CAC');
    expect(cac?.reason).toMatchObject({
      code: 'CAC_NOT_FOUND',
      surface: 'BVR1',
      outcome: 'REJECTED',
      whyHeading: 'Why',
      // BVR1's load-bearing sentence, as a boolean: a failed CAC check is not an identity failure.
      identityLevelAffected: false,
    });
  });
});
