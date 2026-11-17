import { describe, expect, it } from 'vitest';
import {
  activateOwnTotp,
  closeAccount,
  closeAccountBodySchema,
  confirmCurrentPhone,
  confirmNewPhone,
  enrolOwnTotp,
  getMe,
  getVerificationStatus,
  listDevices,
  listFactors,
  listSessions,
  regenerateRecoveryCodes,
  removeFactor,
  requestDataExport,
  requestErasure,
  requestRecovery,
  revokeSession,
  stepUp,
  stepUpBodySchema,
  startPhoneChange,
  submitLiveness,
} from '../src/account.js';

const ID = '0190b0a0-0000-7000-8000-000000000001';
const WHEN = '2026-11-11T10:00:00.000Z';

describe('account endpoints', () => {
  it('are consumer-scoped, and the ones that carry a secret are never retried', () => {
    for (const endpoint of [
      enrolOwnTotp,
      activateOwnTotp,
      regenerateRecoveryCodes,
      stepUp,
      closeAccount,
      requestErasure,
    ]) {
      expect(endpoint).toMatchObject({ scope: 'CONSUMER', retryable: false });
    }
    expect(getMe).toMatchObject({ method: 'get', path: '/me', scope: 'CONSUMER' });
    expect(regenerateRecoveryCodes.path).toBe('/me/mfa/recovery-codes');
    expect(removeFactor).toMatchObject({ method: 'delete', path: '/me/mfa/factors/:id' });
    expect(revokeSession).toMatchObject({ method: 'delete', path: '/me/sessions/:id' });
    expect(requestDataExport).toMatchObject({ method: 'post', path: '/me/data-export' });
  });

  it('parses GET /me as the platform sends it, null open-trade answer included', () => {
    const me = getMe.schema.response.parse({
      id: ID,
      publicId: 'U-AMAKA',
      username: null,
      verificationLevel: 'LEVEL_2',
      account: {
        status: 'SUSPENDED',
        since: WHEN,
        abilities: { login: true, browse: true, buy: false, sell: false, withdraw: true },
        openTrades: null,
        canClose: false,
        supportReference: 'SUP-1234',
        noticeKey: 'ACCOUNT_SUSPENDED',
      },
    });
    expect(me.account.openTrades).toBeNull();
    expect(me.account.noticeKey).toBe('ACCOUNT_SUSPENDED');
  });

  it('parses the paged lists of factors, devices and sessions', () => {
    const paged = (items: unknown[]) => ({ items, page: 1, limit: 50, total: items.length });
    const factors = listFactors.schema.response.parse(
      paged([
        {
          id: ID,
          type: 'TOTP',
          label: 'Authenticator app',
          isDefault: true,
          createdAt: WHEN,
          lastUsedAt: null,
        },
        {
          id: ID,
          type: 'RECOVERY_CODE',
          label: 'Backup codes',
          isDefault: false,
          createdAt: WHEN,
          lastUsedAt: null,
          remaining: 8,
        },
      ]),
    );
    expect(factors.items[1]?.remaining).toBe(8);
    const devices = listDevices.schema.response.parse(
      paged([
        {
          id: ID,
          fingerprintHint: 'abc123',
          platform: 'WEB',
          osVersion: null,
          appVersion: null,
          model: null,
          status: 'ACTIVE',
          trustedAt: null,
          firstSeenAt: WHEN,
          lastSeenAt: WHEN,
          hasPushToken: false,
        },
      ]),
    );
    expect(devices.items).toHaveLength(1);
    const sessions = listSessions.schema.response.parse(
      paged([
        {
          id: ID,
          scope: 'CONSUMER',
          amr: ['pwd'],
          deviceId: null,
          deviceLabel: 'Chrome on Mac',
          ip: null,
          issuedAt: WHEN,
          lastUsedAt: WHEN,
          idleExpiresAt: WHEN,
          current: true,
        },
      ]),
    );
    expect(sessions.items[0]?.current).toBe(true);
  });

  it('keeps the rejection copy and remedy the verification status carries', () => {
    const status = getVerificationStatus.schema.response.parse({
      level: 'LEVEL_0',
      levelNumber: 0,
      levelAttainedAt: null,
      requirements: { identifier: false, liveness: false, business: false, businessBankAccount: false },
      inFlight: [],
      rejections: [
        {
          requestId: ID,
          type: 'LIVENESS',
          decidedAt: WHEN,
          reason: {
            code: 'LIVENESS_FAILED',
            surface: 'VF1',
            outcome: 'FAILED',
            whyHeading: 'Why this usually happens',
            why: 'The photo did not pass.',
            remedy: 'RESUBMIT_WITH_CLEARER_PHOTO',
            identityLevelAffected: true,
          },
        },
      ],
    });
    expect(status.rejections[0]?.reason.remedy).toBe('RESUBMIT_WITH_CLEARER_PHOTO');
  });

  it('asks a step-up for exactly one proof', () => {
    expect(stepUpBodySchema.safeParse({ factorId: ID, code: '123456' }).success).toBe(true);
    expect(stepUpBodySchema.safeParse({ password: 'x' }).success).toBe(true);
    expect(stepUpBodySchema.safeParse({ code: '123456', password: 'x' }).success).toBe(false);
    expect(stepUpBodySchema.safeParse({}).success).toBe(false);
  });

  it('refuses a free-text reason on close: only the four codes exist', () => {
    expect(closeAccountBodySchema.safeParse({ reason: 'NOT_USING', password: 'x' }).success).toBe(true);
    expect(closeAccountBodySchema.safeParse({ reason: 'because I said so' }).success).toBe(false);
  });

  it('takes a selfie file id for liveness and nothing else', () => {
    expect(submitLiveness.schema.body?.safeParse({ selfieFileId: ID })?.success).toBe(true);
    expect(submitLiveness.schema.body?.safeParse({ selfieFileId: ID, extra: 1 })?.success).toBe(false);
  });

  it('asks for recovery without a session, and answers the same whether or not the account exists', () => {
    expect(requestRecovery).toMatchObject({
      method: 'post',
      path: '/auth/recovery-requests',
      scope: 'PUBLIC',
    });
    expect(
      requestRecovery.schema.body?.safeParse({ identifier: '08032214471', method: 'LOST_PHONE' }).success,
    ).toBe(true);
    expect(
      requestRecovery.schema.body?.safeParse({ identifier: '08032214471', method: 'SHRUG' }).success,
    ).toBe(false);
    expect(requestRecovery.schema.response.parse({ receiptId: ID, status: 'RECEIVED' }).status).toBe(
      'RECEIVED',
    );
  });

  it('mirrors the three steps of a phone change, none of them retried', () => {
    for (const [endpoint, path] of [
      [startPhoneChange, '/me/phone/change'],
      [confirmCurrentPhone, '/me/phone/change/confirm-current'],
      [confirmNewPhone, '/me/phone/change/confirm-new'],
    ] as const) {
      expect(endpoint).toMatchObject({ method: 'post', path, scope: 'CONSUMER', retryable: false });
    }
    expect(
      startPhoneChange.schema.response.parse({
        changeId: ID,
        challengeId: ID,
        maskedDestination: '+23480•••4471',
        expiresAt: WHEN,
        delivered: true,
      }).maskedDestination,
    ).toBe('+23480•••4471');
    expect(
      confirmNewPhone.schema.response.parse({ status: 'CHANGED', maskedPhone: '+23490•••2290' }).status,
    ).toBe('CHANGED');
    expect(
      confirmCurrentPhone.schema.body?.safeParse({ changeId: ID, challengeId: ID, code: '123456' }).success,
    ).toBe(true);
  });
});
