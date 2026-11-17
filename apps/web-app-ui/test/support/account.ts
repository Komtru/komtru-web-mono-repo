// Account fixtures in the platform's own shapes (`@komtru/api-client`'s account schemas parse every one).
import { ProblemError } from '@komtru/api-client';
import { id } from './trade';

export const ME_ID = id(1);
export const WHEN = '2026-11-14T10:00:00.000Z';

export const paged = <T>(items: T[]) => ({ items, page: 1, limit: 50, total: items.length });

export const me = (account: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) => ({
  id: ME_ID,
  publicId: 'U-AMAKA',
  username: 'amaka',
  verificationLevel: 'LEVEL_2',
  account: {
    status: 'ACTIVE',
    since: null,
    abilities: { login: true, browse: true, buy: true, sell: true, withdraw: true },
    openTrades: false,
    canClose: true,
    supportReference: 'SUP-7KQ2',
    noticeKey: null,
    ...account,
  },
  ...rest,
});

export const factor = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(100 + n),
  type: 'TOTP',
  label: 'Authenticator app',
  isDefault: true,
  createdAt: WHEN,
  lastUsedAt: null,
  ...over,
});

export const recoverySheet = (remaining = 8) =>
  factor(9, { type: 'RECOVERY_CODE', label: 'Backup codes', isDefault: false, remaining });

export const device = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(200 + n),
  fingerprintHint: `fp${String(n)}`,
  platform: 'WEB',
  osVersion: null,
  appVersion: null,
  model: n === 1 ? 'iPhone 13' : 'Samsung A52',
  status: 'ACTIVE',
  trustedAt: null,
  firstSeenAt: WHEN,
  lastSeenAt: WHEN,
  hasPushToken: false,
  ...over,
});

export const session = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(300 + n),
  scope: 'CONSUMER',
  amr: ['pwd'],
  deviceId: id(200 + n),
  deviceLabel: 'device',
  ip: null,
  issuedAt: WHEN,
  lastUsedAt: WHEN,
  idleExpiresAt: WHEN,
  current: n === 1,
  ...over,
});

export const problem = (code: string, status = 409, extra: Record<string, unknown> = {}) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded title', status, code, ...extra },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

export const status = (over: Record<string, unknown> = {}) => ({
  level: 'LEVEL_0',
  levelNumber: 0,
  levelAttainedAt: null,
  requirements: { identifier: false, liveness: false, business: false, businessBankAccount: false },
  inFlight: [],
  rejections: [],
  ...over,
});

export const rejection = (type: string, over: Record<string, unknown> = {}) => ({
  requestId: id(400),
  type,
  decidedAt: WHEN,
  reason: {
    code: 'ID_IMAGE_UNCLEAR',
    surface: 'VF1',
    outcome: 'FAILED',
    whyHeading: 'Why this usually happens',
    why: 'A blurry photo or glare across the ID is the usual cause — not a judgment on the document itself.',
    remedy: 'RESUBMIT_WITH_CLEARER_PHOTO',
    identityLevelAffected: true,
    ...over,
  },
});
