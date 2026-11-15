// The merchant module's six questions bound to the real files, geo, config and ledger barrels, and the
// whole KYC-document path with them: submit, the reviewer grant, a staff retrieval through M20, and the
// `file_access_log` row that retrieval writes. Nothing here is stubbed except Cloudinary's bytes: URLs are
// signed locally by arithmetic, so a real signed URL comes back.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FilesConfig } from '../../../src/config/env.js';
import { createDb, type Db } from '../../../src/db/index.js';
import { configModule } from '../../../src/modules/config/index.js';
import { listAccessLog, listGrants } from '../../../src/modules/files/index.js';
import { seedStorageAccounts } from '../../../src/modules/files/services/account.service.js';
import { geoModule } from '../../../src/modules/geo/index.js';
import { insertPayoutAccount } from '../../../src/modules/ledger/infrastructure/postgres/payoutsRepository.js';
import { bindPorts, reviewerRoles } from '../../../src/modules/merchant/infrastructure/ports.js';
import {
  getApplicationDetail,
  assignApplication,
  decideApplication,
} from '../../../src/modules/merchant/services/review.service.js';
import { saveDraft, submitApplication } from '../../../src/modules/merchant/services/application.service.js';
import { createEncryption } from '../../../src/platform/crypto/encryption.js';
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';
import { createLogger } from '../../../src/platform/logger.js';
import type { QueueFactory } from '../../../src/platform/queue/factory.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { seedUser, testConfig } from '../identity/support.js';
import { insertFileRecord } from '../files/support.js';
import { anyString } from './support.js';
import type { EvidenceJob } from '../../../src/modules/merchant/services/ports.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const files: FilesConfig = {
  accounts: Object.fromEntries(
    [
      'CLOUDINARY_PROFILE',
      'CLOUDINARY_CHAT',
      'CLOUDINARY_TRADE_1',
      'CLOUDINARY_TRADE_2',
      'CLOUDINARY_TRADE_3',
    ].map((prefix) => [prefix, { cloudName: `c-${prefix}`, apiKey: '1234', apiSecret: 'not-a-real-secret' }]),
  ),
  maxUploadBytes: 1_000_000,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
};

describe('the reviewer roles', () => {
  it('are the roles that may view an application, read from the RBAC catalogue', () => {
    expect([...reviewerRoles()].sort()).toEqual(['KYC_ANALYST', 'OPERATIONS_ADMIN', 'SUPER_ADMIN']);
  });
});

describe.runIf(infraEnabled)('the merchant ports against the real modules (T-055)', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());
  const config = () => ({ ...testConfig(), files });

  const enqueued: { job: EvidenceJob; delay: number | undefined }[] = [];
  const queues = {
    producer: () => ({
      add: (_name: string, job: EvidenceJob, options?: { delay?: number }) => {
        enqueued.push({ job, delay: options?.delay });
        return Promise.resolve({});
      },
    }),
  } as unknown as QueueFactory;

  const ports = () => {
    const cfg = config();
    return bindPorts({ db: db(), config: cfg, logger, queues, encryption: createEncryption(cfg) });
  };

  const kycFile = async (
    uploaderUserId: string,
    overrides: { uploadState?: string; category?: string } = {},
  ) => {
    await seedStorageAccounts(db(), files, logger);
    const accountId = (
      await t
        .owner()
        .query<{ id: string }>(`SELECT id FROM files.storage_accounts WHERE pool = 'TRADE_ASSET' LIMIT 1`)
    ).rows[0]?.id;
    if (!accountId) throw new Error('no trade storage account');
    const id = await insertFileRecord(t.owner(), {
      accountId,
      uploaderUserId,
      category: overrides.category ?? 'KYC_DOCUMENT',
      visibility: 'PRIVATE_OWNER',
      contentType: 'application/pdf',
    });
    await t
      .owner()
      .query(`UPDATE files.file_records SET upload_state = $2, size_bytes = 2048 WHERE id = $1`, [
        id,
        overrides.uploadState ?? 'READY',
      ]);
    return id;
  };

  it('answers about a file, and grants the reviewer roles once however often it is asked', async () => {
    const { userId } = await seedUser(t.app());
    const fileId = await kycFile(userId);
    const p = ports();
    expect(await p.findFile(fileId)).toMatchObject({
      id: fileId,
      uploaderUserId: userId,
      category: 'KYC_DOCUMENT',
      status: 'ACTIVE',
      uploadState: 'READY',
    });
    expect(await p.findFile(randomUUID())).toBeUndefined();

    await p.grantReviewerAccess(fileId);
    await p.grantReviewerAccess(fileId);
    const grants = await listGrants(db(), fileId);
    expect(grants.map((g) => g.granteeRole).sort()).toEqual([
      'KYC_ANALYST',
      'OPERATIONS_ADMIN',
      'SUPER_ADMIN',
    ]);
  });

  it('answers about the catalogue: categories, a city in its state, and a payout account of one’s own', async () => {
    await configModule.seed?.(db());
    await geoModule.seed?.(db());
    const p = ports();
    const categories = await p.categoryCodes();
    expect(categories.length).toBeGreaterThan(0);
    expect(new Set(categories).size).toBe(categories.length);

    const city = (
      await t
        .owner()
        .query<{ id: string; state_id: string }>(`SELECT id, state_id FROM geo.cities WHERE active LIMIT 1`)
    ).rows[0];
    const otherState = (
      await t
        .owner()
        .query<{ id: string }>(`SELECT id FROM geo.states WHERE id <> $1 LIMIT 1`, [city?.state_id])
    ).rows[0];
    expect(await p.cityBelongsToState(city?.state_id ?? '', city?.id ?? '')).toBe(true);
    expect(await p.cityBelongsToState(otherState?.id ?? '', city?.id ?? '')).toBe(false);
    expect(await p.locationLabel(city?.id ?? '')).toMatchObject({
      stateName: anyString(),
      cityName: anyString(),
    });
    expect(await p.locationLabel(randomUUID())).toBeUndefined();

    const cfg = config();
    const hasher = createHmacHasher(cfg.identity.hmacPepper ?? 'x'.repeat(32));
    const { userId } = await seedUser(t.app());
    const account = await insertPayoutAccount(db(), {
      userId,
      provider: 'PAYSTACK',
      bankCode: '058',
      bankName: 'Guaranty Trust Bank',
      accountNumberEnc: createEncryption(cfg).encrypt('0123455567'),
      accountNumberMasked: '******5567',
      accountNumberHash: hasher.hmac('ledger:payout-account', randomUUID()),
      status: 'VERIFIED',
      accountName: 'TECHEDGE NIGERIA LTD',
      providerRecipientId: 'RCP_x',
      verifiedAt: new Date(),
      nameMatchResult: 'EXACT',
    });
    expect(await p.payoutAccountOf(userId, account.id)).toMatchObject({
      status: 'VERIFIED',
      accountNumberMasked: '******5567',
      nameMatchResult: 'EXACT',
    });
    // Someone else's account is not theirs to name on a form.
    expect(await p.payoutAccountOf((await seedUser(t.app())).userId, account.id)).toBeUndefined();
  });

  it('enqueues the evidence job with its delay, and asks trust for the CAC lookup without throwing', async () => {
    const p = ports();
    await p.enqueueEvidence({ applicationId: randomUUID(), attempt: 2 }, 300_000);
    expect(enqueued.at(-1)).toMatchObject({ job: { attempt: 2 }, delay: 300_000 });
    // An applicant who has not verified their identity: an outcome, not an exception.
    const { userId } = await seedUser(t.app());
    expect(await p.requestCacLookup({ userId, rcNumber: 'RC123456' })).toMatchObject({ outcome: 'BLOCKED' });
  });

  it('serves a KYC document to a reviewer only after submit, and writes the access log for every view', async () => {
    await configModule.seed?.(db());
    await geoModule.seed?.(db());
    const real = ports();
    const { userId } = await seedUser(t.app());
    const cfg = config();
    const hasher = createHmacHasher(cfg.identity.hmacPepper ?? 'x'.repeat(32));
    const payout = await insertPayoutAccount(db(), {
      userId,
      provider: 'PAYSTACK',
      bankCode: '058',
      accountNumberEnc: createEncryption(cfg).encrypt('0123455567'),
      accountNumberMasked: '******5567',
      accountNumberHash: hasher.hmac('ledger:payout-account', randomUUID()),
      status: 'VERIFIED',
      accountName: 'TECHEDGE NIGERIA LTD',
      providerRecipientId: 'RCP_y',
      verifiedAt: new Date(),
    });
    const city = (
      await t
        .owner()
        .query<{ id: string; state_id: string }>(`SELECT id, state_id FROM geo.cities WHERE active LIMIT 1`)
    ).rows[0];
    const [cac, report, director] = await Promise.all([kycFile(userId), kycFile(userId), kycFile(userId)]);
    const category = (await real.categoryCodes())[0] ?? '';

    const deps = { db: db(), ports: real, logger };
    const saved = await saveDraft(deps, userId, {
      businessName: 'Techedge Nigeria Ltd',
      businessType: 'REGISTERED_BUSINESS',
      addressLine: '12 Allen Avenue',
      stateId: city?.state_id ?? '',
      cityId: city?.id ?? '',
      categories: [category],
      cacRcNumber: 'RC123456',
      payoutAccountId: payout.id,
      documents: [
        { docType: 'CAC_CERTIFICATE', fileId: cac },
        { docType: 'STATUS_REPORT', fileId: report },
        { docType: 'DIRECTOR_ID', fileId: director },
      ],
    });
    // Before submit, no reviewer holds a grant on any of them.
    expect(await listGrants(db(), cac)).toHaveLength(0);
    await submitApplication(deps, { userId, applicationId: saved.id, mode: 'SUBMIT' });
    expect((await listGrants(db(), cac)).map((g) => g.granteeRole).sort()).toEqual([
      'KYC_ANALYST',
      'OPERATIONS_ADMIN',
      'SUPER_ADMIN',
    ]);

    const reviewer = (await seedUser(t.app())).userId;
    const detail = await getApplicationDetail(deps, {
      applicationId: saved.id,
      viewer: { userId: reviewer, roles: ['KYC_ANALYST'] },
    });
    expect(detail.documents.map((d) => d.url !== null)).toEqual([true, true, true]);
    expect(detail.documents[0]?.url).toContain('c-CLOUDINARY_TRADE');
    const log = await listAccessLog(db(), cac, { limit: 10 });
    expect(log.map((row) => [row.accessedByAdminId, row.accessGranted])).toEqual([[reviewer, true]]);

    // A staff member without a granted role is refused, and the refusal is logged too.
    const outsider = (await seedUser(t.app())).userId;
    const refused = await getApplicationDetail(deps, {
      applicationId: saved.id,
      viewer: { userId: outsider, roles: ['DISPUTE_REVIEWER'] },
    });
    expect(refused.documents.map((d) => d.url)).toEqual([null, null, null]);
    expect((await listAccessLog(db(), cac, { limit: 10 })).map((r) => r.accessGranted)).toEqual([
      false,
      true,
    ]);

    // And the whole certification runs against the real bindings.
    const actor = { userId: reviewer, roles: ['KYC_ANALYST'] };
    await assignApplication(db(), { actor, applicationId: saved.id });
    expect(
      await decideApplication(db(), {
        actor,
        applicationId: saved.id,
        decision: { outcome: 'APPROVE' },
        reason: 'Verified',
        policyCitation: 'MER-POL-2.1',
      }),
    ).toMatchObject({ status: 'APPROVED', storefrontSlug: 'techedge-nigeria-ltd' });
  });
});
