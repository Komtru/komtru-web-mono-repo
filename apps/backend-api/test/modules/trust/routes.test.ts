// The M6 §11 user surface, read off the declarations the platform checks at boot, plus the one
// read model behind it.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RouteDefinition } from '../../../src/platform/http/route.js';
import { routeLabel } from '../../../src/platform/http/route.js';
import { trustRoutes } from '../../../src/modules/trust/http/routes.js';
import { WEBHOOK_PATH_PREFIX } from '../../../src/platform/http/raw-body.js';
import { youverifyWebhookRoutes } from '../../../src/modules/trust/http/webhook.routes.js';
import { trustAdminRoutes } from '../../../src/modules/trust/http/admin.routes.js';
import { decideBody } from '../../../src/modules/trust/http/admin.validations.js';
import { isKnownPermission } from '../../../src/modules/identity/index.js';
import {
  addressBody,
  bankAccountBody,
  businessBody,
  bvnBody,
  ninBody,
  livenessBody,
  socialProofBody,
  statusResponse,
} from '../../../src/modules/trust/http/validations.js';
import { readVerificationStatus } from '../../../src/modules/trust/services/verification.service.js';
import { requestRow, silentLogger, stubStore, testEncryption, testHasher } from './support.js';
import { testModule } from '../../support/modules.js';

const deps = {
  store: () => stubStore(),
  hasher: () => testHasher(),
  encryption: () => testEncryption(),
  requestTtlMinutes: () => 60,
  logger: () => silentLogger(),
  // Never reached: these tests read route declarations, they do not run handlers.
  queues: () => ({ producer: () => ({ add: () => Promise.resolve(undefined) }) }) as never,
  youverify: () => undefined,
};

const routes: RouteDefinition[] = trustRoutes(deps);
const labels = routes.map(routeLabel);
const routeFor = (label: string): RouteDefinition => {
  const found = routes.find((route) => routeLabel(route) === label);
  if (!found) throw new Error(`no route ${label}`);
  return found;
};

describe('trustRoutes', () => {
  it('declares the M6 §11 user surface', () => {
    expect(labels).toEqual([
      'POST /verification/nin',
      'POST /verification/bvn',
      'POST /verification/liveness',
      // Not in §11's original table: the browser-SDK session, added when liveness stopped being a
      // call this backend makes and became one the user's browser makes on our behalf.
      'POST /verification/liveness/session',
      'POST /verification/business',
      'POST /verification/bank-account',
      'POST /verification/address',
      'POST /verification/social-proof',
      'POST /verification/social-proof/:id/confirm',
      'GET /verification/social-proof',
      'GET /verification/status',
    ]);
  });

  /** §11's admin half is `trustAdminRoutes` (T-052), declared separately and asserted below. */
  it('keeps the user surface free of /admin', () => {
    expect(labels.filter((label) => label.includes('/admin'))).toEqual([]);
  });

  it('scopes every route to CONSUMER', () => {
    for (const route of routes) expect(route.scope).toBe('CONSUMER');
  });

  it('rate-limits each submission on both the IP and the user, because each one costs money', () => {
    for (const label of labels.filter((l) => l.startsWith('POST'))) {
      expect(routeFor(label).rateLimit?.by).toEqual(expect.arrayContaining(['ip', 'user']));
    }
  });

  it('answers 202 on every check, because the provider is never called on the request path', () => {
    // Two deliberate exceptions. The handle claim really has created the thing it returns, so it
    // answers 201. The liveness session answers 200 because it is not a check at all: it hands the
    // caller the merchant key and reference its browser needs NOW, and 202 would promise a result
    // that is never coming on this response — the verdict arrives over a webhook.
    const synchronous = new Set(['POST /verification/social-proof', 'POST /verification/liveness/session']);
    const checks = labels.filter((l) => l.startsWith('POST') && !synchronous.has(l));
    for (const label of checks) expect(routeFor(label).status).toBe(202);
    expect(routeFor('POST /verification/social-proof').status).toBe(201);
    expect(routeFor('POST /verification/liveness/session').status).toBeUndefined();
  });

  /**
   * The claim is the one route in this module a flaky connection can genuinely double-submit: the
   * `social_proof_claims` unique indexes are partial on `verified = true`, so a second unverified
   * claim succeeds — issuing a fresh code and invalidating the one the user just published.
   */
  it('asks for an idempotency key exactly where the database does not already refuse a repeat', () => {
    expect(routeFor('POST /verification/social-proof').retryable).toBe(true);
    for (const label of labels.filter(
      (l) => l.startsWith('POST') && l !== 'POST /verification/social-proof',
    )) {
      expect(routeFor(label).retryable).toBe(false);
    }
  });

  it('paginates the one route that returns a collection', () => {
    expect(routeFor('GET /verification/social-proof').paginated).toBe('page');
    expect(routeFor('GET /verification/status').paginated).toBeUndefined();
  });

  it('states a retryable decision on every mutating route', () => {
    for (const label of labels.filter((l) => l.startsWith('POST'))) {
      expect(typeof routeFor(label).retryable).toBe('boolean');
    }
  });

  it('is what the registry mounts', () => {
    const admin = trustAdminRoutes({ db: () => ({}) as never }).map(routeLabel);
    const webhooks = youverifyWebhookRoutes(() => ({}) as never).map(routeLabel);
    expect((testModule('trust').routes ?? []).map(routeLabel)).toEqual([...labels, ...admin, ...webhooks]);
  });

  /**
   * The webhook is the one route here with no session behind it, so its two properties are asserted
   * rather than assumed: PUBLIC scope is what lets Youverify reach it at all, and the path has to
   * sit under the raw-body prefix or the signature check has no bytes to verify.
   */
  it('mounts the youverify webhook public and under the raw-body prefix', () => {
    const [route] = youverifyWebhookRoutes(() => ({}) as never);
    expect(route?.scope).toBe('PUBLIC');
    expect(`/v1${route?.path ?? ''}/`.startsWith(WEBHOOK_PATH_PREFIX)).toBe(true);
    expect(route?.rateLimit?.by).toEqual(['ip']);
  });
});

describe('request bodies', () => {
  it('rejects a body carrying an unexpected field', () => {
    expect(ninBody.safeParse({ nin: '12345678904', firstName: 'A', lastName: 'B', note: 'x' }).success).toBe(
      false,
    );
  });

  it('accepts the fields the KYC form collects', () => {
    expect(
      ninBody.safeParse({
        nin: '123-456-789-04',
        firstName: 'Ada',
        lastName: 'Obi',
        dateOfBirth: '1994-02-03',
      }).success,
    ).toBe(true);
    expect(bvnBody.safeParse({ bvn: '12345678904', firstName: 'Ada', lastName: 'Obi' }).success).toBe(true);
  });

  it('wants a uuid for the selfie, not any string a client invents', () => {
    expect(livenessBody.safeParse({ selfieFileId: 'not-a-uuid' }).success).toBe(false);
    expect(livenessBody.safeParse({ selfieFileId: randomUUID() }).success).toBe(true);
  });

  it('refuses a date of birth that is not a date', () => {
    expect(
      ninBody.safeParse({ nin: '12345678904', firstName: 'A', lastName: 'B', dateOfBirth: 'yesterday' })
        .success,
    ).toBe(false);
  });
});

describe('readVerificationStatus', () => {
  it('reports the level, what is still needed, and what is in flight', async () => {
    const userId = randomUUID();
    const open = requestRow({ userId, verificationType: 'NIN', status: 'PROVIDER_PENDING' });
    const store = stubStore({
      subject: { userId, status: 'ACTIVE', verificationLevel: 'CONTACT_VERIFIED' },
      facts: { identifierVerified: true, latestVerifiedIdentifier: 'NIN', livenessPassed: false },
      openRequests: [open],
    });

    const status = await readVerificationStatus({ store }, userId);

    expect(status).toMatchObject({
      level: 'CONTACT_VERIFIED',
      levelNumber: 1,
      requirements: { identifier: true, liveness: false },
      inFlight: [{ requestId: open.id, type: 'NIN', status: 'PROVIDER_PENDING' }],
    });
  });

  it('never echoes anything that could identify the number behind a check', async () => {
    const userId = randomUUID();
    const store = stubStore({ openRequests: [requestRow({ userId })] });
    const status = await readVerificationStatus({ store }, userId);
    expect(JSON.stringify(status)).not.toMatch(/masked|hash|nin_|bvn_/i);
  });

  it('refuses a caller whose user row is gone', async () => {
    await expect(
      readVerificationStatus({ store: stubStore({ subject: undefined }) }, randomUUID()),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('the T-051 request bodies', () => {
  it('takes a CAC number with or without its prefix and separators', () => {
    for (const rcNumber of ['RC 1487322', 'rc-1487322', '1487322']) {
      expect(businessBody.safeParse({ rcNumber }).success).toBe(true);
    }
  });

  it('refuses an extra field, which would otherwise be sealed into a job and sent to a provider', () => {
    expect(
      businessBody.safeParse({ rcNumber: '1487322', firstName: 'A', lastName: 'B', note: 'x' }).success,
    ).toBe(false);
    expect(
      bankAccountBody.safeParse({ accountNumber: '0123456789', bankCode: '058', pin: '1234' }).success,
    ).toBe(false);
  });

  it('wants a plausible NUBAN, leaving the exact check to the service after normalising', () => {
    expect(bankAccountBody.safeParse({ accountNumber: '0123456789', bankCode: '058' }).success).toBe(true);
    expect(bankAccountBody.safeParse({ accountNumber: '123', bankCode: '058' }).success).toBe(false);
  });

  /** `PROVIDER_LOOKUP` is in the column's enum so a later lookup is not a migration — and nothing
   *  is behind it today, so a client must not be able to ask for it. */
  it('offers only the two address methods that have something behind them', () => {
    const base = { addressLine1: '1 Allen Ave', city: 'Ikeja', state: 'Lagos', documentFileId: randomUUID() };
    expect(addressBody.safeParse({ ...base, method: 'UTILITY_BILL' }).success).toBe(true);
    expect(addressBody.safeParse({ ...base, method: 'BANK_STATEMENT' }).success).toBe(true);
    expect(addressBody.safeParse({ ...base, method: 'PROVIDER_LOOKUP' }).success).toBe(false);
  });

  it('wants a uuid for the proof document, not any string a client invents', () => {
    const base = { addressLine1: '1 Allen Ave', city: 'Ikeja', state: 'Lagos', method: 'UTILITY_BILL' };
    expect(addressBody.safeParse({ ...base, documentFileId: 'nope' }).success).toBe(false);
  });

  it('accepts only the two platforms M1 §7.2 names', () => {
    expect(socialProofBody.safeParse({ platform: 'INSTAGRAM', handle: 'techedge_ng' }).success).toBe(true);
    expect(socialProofBody.safeParse({ platform: 'X', handle: 'techedge_ng' }).success).toBe(true);
    expect(socialProofBody.safeParse({ platform: 'TIKTOK', handle: 'techedge_ng' }).success).toBe(false);
  });
});

describe('statusResponse', () => {
  /**
   * The schema is applied with `safeParse` and `z.object` STRIPS what it does not declare, so a
   * schema narrower than its service is a silent filter rather than a validation. It used to declare
   * neither `rejections` nor the two business requirements, which meant the endpoint dropped exactly
   * the data BVR1 and VF1 exist to render, with nothing anywhere reporting it.
   */
  it('keeps the whole of what readVerificationStatus returns, rejections included', async () => {
    const userId = randomUUID();
    const rejected = requestRow({ userId, verificationType: 'CAC', status: 'REJECTED' });
    const status = await readVerificationStatus(
      {
        store: stubStore({
          subject: { userId, status: 'ACTIVE', verificationLevel: 'IDENTITY_VERIFIED' },
          facts: { identifierVerified: true, livenessPassed: true },
          businessFacts: { currentLevel: 2, cacVerified: false, businessBankMatched: false },
          rejections: [
            {
              requestId: rejected.id,
              verificationType: 'CAC',
              rejectionReason: 'CAC_NOT_FOUND',
              decidedAt: new Date(),
            },
          ],
        }),
      },
      userId,
    );

    const parsed = statusResponse.safeParse(status);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      requirements: { identifier: true, liveness: true, business: false, businessBankAccount: false },
      rejections: [
        {
          type: 'CAC',
          reason: {
            code: 'CAC_NOT_FOUND',
            surface: 'BVR1',
            outcome: 'REJECTED',
            whyHeading: 'Why',
            // BVR1's load-bearing sentence: a failed CAC check must not read as an identity failure.
            identityLevelAffected: false,
          },
        },
      ],
    });
    expect(parsed.data?.rejections[0]?.reason.why).toMatch(/doesn’t|doesn't/);
  });
});

describe('trustAdminRoutes', () => {
  const adminRoutes = trustAdminRoutes({ db: () => ({}) as never });
  const adminLabels = adminRoutes.map(routeLabel);
  const adminRoute = (label: string): RouteDefinition => {
    const found = adminRoutes.find((route) => routeLabel(route) === label);
    if (!found) throw new Error(`no route ${label}`);
    return found;
  };

  it('declares M6 §11’s admin surface, plus the override pair', () => {
    expect(adminLabels).toEqual([
      'GET /admin/kyc/queue',
      'GET /admin/kyc/queue/:requestId',
      'POST /admin/kyc/queue/:requestId/assign',
      'POST /admin/kyc/queue/:requestId/decide',
      'GET /admin/kyc/duplicate-flags',
      'POST /admin/kyc/duplicate-flags/:id/resolve',
      'POST /admin/kyc/overrides',
      'POST /admin/kyc/overrides/:approvalId/execute',
    ]);
  });

  it('puts every route in the STAFF scope behind a catalogued permission', () => {
    for (const route of adminRoutes) {
      expect(route.scope).toBe('STAFF');
      expect(isKnownPermission(route.permission ?? '')).toBe(true);
    }
    expect(adminRoute('POST /admin/kyc/overrides').permission).toBe('verification.override');
    expect(adminRoute('POST /admin/kyc/overrides/:approvalId/execute').permission).toBe(
      'verification.override',
    );
    expect(adminRoute('POST /admin/kyc/queue/:requestId/decide').permission).toBe('verification.review');
    expect(adminRoute('POST /admin/kyc/duplicate-flags/:id/resolve').permission).toBe(
      'duplicate_flag.resolve',
    );
  });

  it('paginates the two lists', () => {
    expect(adminRoute('GET /admin/kyc/queue').paginated).toBe('page');
    expect(adminRoute('GET /admin/kyc/duplicate-flags').paginated).toBe('page');
  });

  it('refuses a decision body that tries to carry anything but an outcome, reason and citation', () => {
    expect(decideBody.safeParse({ outcome: 'APPROVE', reason: 'ok' }).success).toBe(true);
    expect(decideBody.safeParse({ outcome: 'APPROVE', advisory: 'approve' }).success).toBe(false);
    expect(decideBody.safeParse({ outcome: 'MAYBE' }).success).toBe(false);
  });
});
