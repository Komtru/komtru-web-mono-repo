// Backend configuration, parsed once at boot from the environment.
//
// SECURITY: the backend's .env holds live credentials. Errors from this module name the variables that
// are missing or invalid, never their values.
import { z } from 'zod';
import { BULL_PREFIX, KEY_PREFIX } from '../platform/redis/connections.js';

const NODE_ENVS = ['development', 'test', 'production'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const int = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const list = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * A Google service account, as FCM_SERVICE_ACCOUNT_JSON carries it. Parsed here so a truncated or
 * mis-pasted key fails at boot, naming the variable, rather than at the first push notification.
 * Only the three fields the token exchange needs are kept; nothing else of a credential file is
 * worth holding in memory.
 */
const serviceAccount = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'not valid JSON' });
      return z.NEVER;
    }
  })
  .pipe(
    z.object({
      client_email: z.string().min(1),
      private_key: z.string().min(1),
      token_uri: z.url(),
    }),
  );

/** One entry per environment variable: its schema and whether it may be absent. */
const VARIABLES = {
  NODE_ENV: { schema: z.enum(NODE_ENVS), required: false },
  // 0 asks the OS for any free port (used by tests).
  PORT: { schema: int(0, 65535), required: false },
  LOG_LEVEL: { schema: z.enum(LOG_LEVELS), required: false },
  LOG_FORMAT: { schema: z.enum(['json', 'pretty']), required: false },
  ALLOWED_ORIGINS: { schema: list, required: false },
  TRUST_PROXY_HOPS: { schema: int(0, 10), required: false },
  POSTGRES_URL: { schema: z.url(), required: true },
  POSTGRES_DIRECT_URL: { schema: z.url(), required: false },
  POSTGRES_APP_PASSWORD: { schema: z.string().min(8), required: false },
  POSTGRES_SSL: { schema: bool, required: false },
  POSTGRES_POOL_MAX: { schema: int(1, 200), required: false },
  REDIS_URL: { schema: z.url(), required: true },
  // The namespace every Redis key lands under. Production leaves both unset; the integration suite
  // sets them per Vitest worker so parallel test files cannot see each other's queues and counters.
  // Empty is rejected rather than treated as unset: at the call site the two are indistinguishable,
  // and they mean the opposite things.
  REDIS_KEY_PREFIX: { schema: z.string().min(1), required: false },
  REDIS_QUEUE_PREFIX: { schema: z.string().min(1), required: false },
  SENTRY_DSN: { schema: z.url(), required: false },
  // 32 bytes of hex. The name is the old backend's, so its .env drops in unchanged (design §3.4);
  // nothing it encrypted migrates, so rotating the value costs a redeploy and nothing else.
  ENCRYPTION_KEY: { schema: z.string().regex(/^[0-9a-fA-F]{64}$/), required: false },
  SCHEDULER_TIMEZONE: {
    schema: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }),
    required: false,
  },
  SENTRY_ENVIRONMENT: { schema: z.string().min(1), required: false },
  // 32 raw bytes as 64 hex characters: the Ed25519 *seed*, which is what the old backend's .env
  // holds. The public half is derived from it, so there is no second variable to keep in sync.
  IDENTITY_SIGNING_KEY: { schema: z.string().regex(/^[0-9a-fA-F]{64}$/), required: false },
  IDENTITY_SIGNING_KEY_ID: { schema: z.string().min(1), required: false },
  IDENTITY_ACCESS_TOKEN_TTL_SECONDS: { schema: int(60, 3600), required: false },
  IDENTITY_TOKEN_ISSUER: { schema: z.url(), required: false },
  IDENTITY_TOKEN_AUDIENCE: { schema: z.string().min(1), required: false },
  IDENTITY_EPOCH_CACHE_TTL_SECONDS: { schema: int(1, 300), required: false },
  // --- Realtime (T-027) ----------------------------------------------------
  SOCKET_ENABLED: { schema: bool, required: false },
  SOCKET_PATH: { schema: z.string().startsWith('/'), required: false },
  SOCKET_CORS_ORIGINS: { schema: list, required: false },
  SOCKET_REVALIDATE_INTERVAL_SECONDS: { schema: int(5, 300), required: false },
  SOCKET_CREDENTIAL_GRACE_SECONDS: { schema: int(0, 600), required: false },
  /**
   * The server-side key every low-entropy identifier is HMAC'd under: OTP codes, destination hashes,
   * recovery claims. 32 characters is the floor because the values it protects are a six-digit code
   * and a phone number — a short pepper is a rainbow table somebody builds in a second.
   */
  IDENTITY_HMAC_PEPPER: { schema: z.string().min(32), required: false },
  IDENTITY_BREACH_CHECK_ENABLED: { schema: bool, required: false },
  /**
   * Local convenience, off everywhere else: SMS runs dry outside production, so a developer never
   * sees a phone OTP. With this on, a phone OTP is also emailed to the user's address if they have
   * one. It never replaces the SMS, and it never applies to a user with no email.
   */
  IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL: { schema: bool, required: false },
  /**
   * The published version of each legal document (NDPA §15, screens TOS1/TOS2). NOT present in
   * docs/specs/backend-apis.env, so `pnpm env:backend` does not write them and every environment
   * gets domain/terms.ts's defaults until an operator sets them.
   */
  APP_TERMS_VERSION: { schema: z.string().min(1).max(32), required: false },
  APP_PRIVACY_VERSION: { schema: z.string().min(1).max(32), required: false },
  // Not shape-checked: a test key and a live key differ only by prefix, so a regex here is a boot
  // failure waiting for the first legitimate key rotation, not a safety net.
  PAYSTACK_SECRET_KEY: { schema: z.string().min(1), required: false },
  PAYSTACK_PUBLIC_KEY: { schema: z.string().min(1), required: false },

  // --- Notifications (M11) -------------------------------------------------
  // All optional: `pnpm env:backend` writes .env from the old backend's live file, not from
  // .env.example, so a required variable here would stop every developer's API booting.
  NOTIFY_DEFAULT_LOCALE: { schema: z.string().min(2), required: false },
  NOTIFY_MAX_ATTEMPTS: { schema: int(1, 20), required: false },
  NOTIFY_RETRY_BASE_DELAY_MS: { schema: int(100, 600_000), required: false },
  NOTIFY_RATE_LIMIT_WINDOW_MINUTES: { schema: int(1, 1440), required: false },
  NOTIFY_RATE_LIMIT_MAX_PER_WINDOW: { schema: int(1, 10_000), required: false },
  /** Renders, records and logs an SMS with the recipient masked, but never sends it. */
  NOTIFY_SMS_DRY_RUN: { schema: bool, required: false },
  NOTIFY_PUSH_DRY_RUN: { schema: bool, required: false },
  MAILJET_API_KEY: { schema: z.string().min(1), required: false },
  MAILJET_API_SECRET: { schema: z.string().min(1), required: false },
  MAILJET_FROM_EMAIL: { schema: z.email(), required: false },
  MAILJET_FROM_NAME: { schema: z.string().min(1), required: false },
  MAILJET_SANDBOX: { schema: bool, required: false },
  TERMII_API_KEY: { schema: z.string().min(1), required: false },
  TERMII_SENDER_ID: { schema: z.string().min(1), required: false },
  TERMII_BASE_URL: { schema: z.url(), required: false },
  FCM_PROJECT_ID: { schema: z.string().min(1), required: false },
  FCM_SERVICE_ACCOUNT_JSON: { schema: serviceAccount, required: false },

  // --- Files and evidence (M20) --------------------------------------------
  // Five independent Cloudinary accounts, three per account, all optional for the same reason the
  // notify block gives: `pnpm env:backend` writes .env from the old backend's live file, so a
  // required variable here stops every developer's API booting. An account with no credentials in
  // this environment is simply skipped by rotation (M20 §5) and its pool fails closed.
  CLOUDINARY_PROFILE_CLOUD_NAME: { schema: z.string().min(1), required: false },
  CLOUDINARY_PROFILE_API_KEY: { schema: z.string().min(1), required: false },
  CLOUDINARY_PROFILE_API_SECRET: { schema: z.string().min(1), required: false },
  CLOUDINARY_CHAT_CLOUD_NAME: { schema: z.string().min(1), required: false },
  CLOUDINARY_CHAT_API_KEY: { schema: z.string().min(1), required: false },
  CLOUDINARY_CHAT_API_SECRET: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_1_CLOUD_NAME: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_1_API_KEY: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_1_API_SECRET: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_2_CLOUD_NAME: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_2_API_KEY: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_2_API_SECRET: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_3_CLOUD_NAME: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_3_API_KEY: { schema: z.string().min(1), required: false },
  CLOUDINARY_TRADE_3_API_SECRET: { schema: z.string().min(1), required: false },
  /** Enforced at finalize, after the bytes have landed: Cloudinary's upload API has no size gate. */
  FILES_MAX_UPLOAD_BYTES: { schema: int(1024, 100 * 1024 * 1024), required: false },
  FILES_UPLOAD_TICKET_TTL_MINUTES: { schema: int(1, 1440), required: false },
  FILES_SIGNED_URL_TTL_SECONDS: { schema: int(30, 3600), required: false },
  FILES_QUOTA_NEAR_PCT: { schema: int(1, 100), required: false },
  FILES_QUOTA_DISABLED_PCT: { schema: int(1, 100), required: false },

  // --- Trust and verification (M6) ------------------------------------------
  /**
   * Who attests an identity. Only the two values with an adapter behind them are accepted — the
   * other five members of the `kyc_provider` enum exist for rows a future adapter will write, and a
   * flag that can name a provider nobody implemented is a flag that cannot be turned on.
   *
   * The default is FAKE, and `loadConfig` refuses that default in production: see the cross-field
   * check below.
   */
  TRUST_KYC_PROVIDER: { schema: z.enum(['FAKE', 'DOJAH']), required: false },
  /** How long an unanswered verification stays open before the sweep expires it (M6 §6.2). */
  TRUST_REQUEST_TTL_MINUTES: { schema: int(5, 10_080), required: false },
  /**
   * Optional, like every other provider credential here: both processes boot without Dojah, and
   * selecting it without all three fails at start naming the ones that are missing rather than at
   * the first verification.
   */
  DOJAH_APP_ID: { schema: z.string().min(1), required: false },
  DOJAH_SECRET_KEY: { schema: z.string().min(1), required: false },
  DOJAH_BASE_URL: { schema: z.url(), required: false },
} satisfies Record<string, { schema: z.ZodType; required: boolean }>;

type VariableName = keyof typeof VARIABLES;
type Parsed = { [K in VariableName]?: z.output<(typeof VARIABLES)[K]['schema']> };

export interface AppConfig {
  nodeEnv: (typeof NODE_ENVS)[number];
  port: number;
  log: { level: (typeof LOG_LEVELS)[number]; format: 'json' | 'pretty' };
  http: { allowedOrigins: string[]; trustProxyHops: number };
  postgres: {
    url: string;
    /** Owner connection, bypassing PgBouncer; migrations only. */
    directUrl?: string;
    /** The migrator sets this as komtru_app's login password. */
    appPassword?: string;
    ssl: boolean;
    poolMax: number;
  };
  redis: {
    url: string;
    /** ioredis `keyPrefix` for the app's own client. */
    keyPrefix: string;
    /** BullMQ's own prefix; it refuses ioredis's `keyPrefix` and takes this instead. */
    queuePrefix: string;
  };
  sentry: { dsn?: string; environment: string };
  /**
   * Optional, not required: the API and worker boot without it, and only a call site that actually
   * encrypts needs it. `createEncryption` fails loudly, naming the variable, when it is absent.
   */
  crypto: { encryptionKey?: string };
  /** Cron schedules are evaluated in this IANA timezone. */
  scheduler: { timezone: string };
  /** Access tokens and the session kill switch (M1 D5). */
  identity: {
    /**
     * Optional for the same reason as `crypto.encryptionKey`: a process with no identity module
     * boots without it. `createTokenSigner` fails loudly, naming the variable, when it is absent.
     */
    signingKey?: string;
    /** The `kid` in every access token header and in the JWKS. */
    signingKeyId?: string;
    accessTokenTtlSeconds: number;
    tokenIssuer: string;
    tokenAudience: string;
    /** How long a user's `sessions_epoch` may be cached in Redis (M1 D5's worst-case exposure). */
    epochCacheTtlSeconds: number;
    /**
     * Optional like `signingKey`: a process with no identity module boots without it, and
     * `createIdentityAuth` fails loudly naming the variable when a login would have needed it.
     */
    hmacPepper?: string;
    /** §S2's k-anonymity check. Off by default so a local run never reaches out to HIBP. */
    breachCheckEnabled: boolean;
    mirrorPhoneOtpToEmail: boolean;
  };
  /**
   * An operator's override of the published legal copy (NDPA §15). Absent means "whatever this
   * build ships": the version of a legal document is identity's fact, not the config loader's, so
   * `resolveTermsVersions` in identity/domain/terms.ts applies the default rather than this file
   * reaching into a module for a constant.
   */
  terms: { version?: string; privacyVersion?: string };
  /**
   * Optional, like `crypto`: both processes boot without Paystack. Absent means every adapter call
   * fails closed with a named error and webhook signatures never verify — never an empty-key HMAC.
   */
  paystack: { secretKey?: string; publicKey?: string };
  notify: NotifyConfig;
  socket: SocketConfig;
  files: FilesConfig;
  trust: TrustConfig;
}

/** The adapters M6 D3 has an implementation for. The schema's `kyc_provider` enum is wider. */
export type KycProviderFlag = 'FAKE' | 'DOJAH';

export interface DojahCredentials {
  appId: string;
  secretKey: string;
  baseUrl: string;
}

export interface TrustConfig {
  /**
   * Which `KycProviderAdapter` the trust module builds at start. `FAKE` is a deterministic stub and
   * every row it writes says so (owner's decision Q7); production cannot select it.
   */
  provider: KycProviderFlag;
  requestTtlMinutes: number;
  /** All three or none, for the reason `filesConfig` gives: two out of three is a 401 nobody can act on. */
  dojah?: DojahCredentials;
}

/** T-027's gateway. A process with `enabled: false` builds no Socket.IO server and no connections. */
export interface SocketConfig {
  enabled: boolean;
  path: string;
  /**
   * Browser origins allowed to open a socket. Empty means no browser may connect, which is why this
   * falls back to `ALLOWED_ORIGINS`: the web apps that call the API are the web apps that open
   * sockets, and the two lists only diverge when someone deliberately separates them.
   */
  corsOrigins: string[];
  /**
   * How often every live credential is re-authenticated. A socket has no "next request" to re-check
   * authorisation on, so the gateway makes one on this timer — which makes this number the worst
   * case for M1 D5's kill switch over an already-open connection.
   */
  revalidateIntervalSeconds: number;
  /**
   * How long past its access token's expiry a socket keeps its place while it is asked to present a
   * fresh one. Zero would drop every socket the moment its 10-minute token lapsed.
   */
  credentialGraceSeconds: number;
}

/** M11's tuning, and one block per provider. A block is absent until its credentials are complete. */
/** One Cloudinary account's credentials (M20 D7): five independent sets, no shared namespace. */
export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface FilesConfig {
  /** Keyed by `storage_accounts.credential_env_prefix`. A half-configured prefix is absent. */
  accounts: Readonly<Record<string, CloudinaryCredentials>>;
  maxUploadBytes: number;
  uploadTicketTtlMinutes: number;
  signedUrlTtlSeconds: number;
  /** M20 §5's thresholds. Placeholders to tune once real volume exists, as the spec says. */
  quota: { nearPct: number; disabledPct: number };
}

export interface NotifyConfig {
  defaultLocale: string;
  /** How many send attempts a notification gets before it is dead-lettered (M11 D3). */
  maxAttempts: number;
  retryBaseDelayMs: number;
  rateLimitWindowMinutes: number;
  rateLimitMaxPerWindow: number;
  /**
   * Outside production both default to true. Local runs keep live provider keys, so this — not the
   * absence of a credential — is what stops a developer texting a real person.
   */
  smsDryRun: boolean;
  pushDryRun: boolean;
  mailjet?: {
    apiKey: string;
    apiSecret: string;
    fromEmail: string;
    fromName: string;
    /** Mailjet validates the request and sends nothing. True locally (set by `pnpm env:backend`). */
    sandbox: boolean;
  };
  termii?: { apiKey: string; senderId: string; baseUrl: string };
  fcm?: { projectId: string; clientEmail: string; privateKey: string; tokenUri: string };
}

export class ConfigError extends Error {
  constructor(
    readonly missing: string[],
    readonly invalid: string[],
  ) {
    const parts = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      invalid.length ? `invalid: ${invalid.join(', ')}` : '',
    ].filter(Boolean);
    super(`Backend configuration is incomplete (${parts.join('; ')}). See apps/backend-api/.env.example.`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed: Record<string, unknown> = {};
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const [name, { schema, required }] of Object.entries(VARIABLES)) {
    const raw = env[name];
    // An empty value means "not set", as `SENTRY_DSN=` does in .env.example.
    if (raw === undefined || raw === '') {
      if (required) missing.push(name);
      continue;
    }
    const result = schema.safeParse(raw);
    if (result.success) parsed[name] = result.data;
    else invalid.push(name);
  }

  // Cross-field, so it cannot live on either variable's own schema: a NEAR_QUOTA threshold at or
  // above the DISABLED one takes an account straight from ACTIVE to DISABLED, and the early warning
  // that is the whole reason M20 §5 polls usage instead of waiting for a failed upload never fires.
  //
  // Compared AFTER defaulting, not as the raw parsed pair: lowering only the disabled threshold
  // leaves near at its default above it, which is the same broken ordering reached by a route the
  // raw comparison cannot see.
  const resolvedNearPct = (parsed.FILES_QUOTA_NEAR_PCT as number | undefined) ?? QUOTA_NEAR_PCT;
  const resolvedDisabledPct = (parsed.FILES_QUOTA_DISABLED_PCT as number | undefined) ?? QUOTA_DISABLED_PCT;
  if (resolvedNearPct >= resolvedDisabledPct) invalid.push('FILES_QUOTA_NEAR_PCT');

  // Cross-field for the same reason: the default is fine everywhere except the one place it is a
  // compliance incident. The fake KYC adapter grants IDENTITY_VERIFIED on the strength of a trailing
  // digit, and a production box that falls back to it quietly is a platform whose verified sellers
  // were verified by nobody. Naming a real provider is a deliberate act; so is this refusal.
  const nodeEnvForTrust = (parsed.NODE_ENV as (typeof NODE_ENVS)[number] | undefined) ?? 'development';
  const resolvedKycProvider = (parsed.TRUST_KYC_PROVIDER as KycProviderFlag | undefined) ?? 'FAKE';
  if (nodeEnvForTrust === 'production' && resolvedKycProvider === 'FAKE') {
    invalid.push('TRUST_KYC_PROVIDER');
  }

  if (missing.length || invalid.length) throw new ConfigError(missing, invalid);

  const v = parsed as Parsed;
  const nodeEnv = v.NODE_ENV ?? 'development';
  return {
    nodeEnv,
    port: v.PORT ?? 7813,
    log: {
      level: v.LOG_LEVEL ?? 'info',
      format: v.LOG_FORMAT ?? (nodeEnv === 'production' ? 'json' : 'pretty'),
    },
    http: { allowedOrigins: v.ALLOWED_ORIGINS ?? [], trustProxyHops: v.TRUST_PROXY_HOPS ?? 0 },
    postgres: {
      url: v.POSTGRES_URL as string,
      ...(v.POSTGRES_DIRECT_URL ? { directUrl: v.POSTGRES_DIRECT_URL } : {}),
      ...(v.POSTGRES_APP_PASSWORD ? { appPassword: v.POSTGRES_APP_PASSWORD } : {}),
      ssl: v.POSTGRES_SSL ?? false,
      poolMax: v.POSTGRES_POOL_MAX ?? 10,
    },
    redis: {
      url: v.REDIS_URL as string,
      keyPrefix: v.REDIS_KEY_PREFIX ?? KEY_PREFIX,
      queuePrefix: v.REDIS_QUEUE_PREFIX ?? BULL_PREFIX,
    },
    crypto: { ...(v.ENCRYPTION_KEY ? { encryptionKey: v.ENCRYPTION_KEY } : {}) },
    scheduler: { timezone: v.SCHEDULER_TIMEZONE ?? 'Africa/Lagos' },
    identity: {
      ...(v.IDENTITY_SIGNING_KEY ? { signingKey: v.IDENTITY_SIGNING_KEY } : {}),
      ...(v.IDENTITY_SIGNING_KEY_ID ? { signingKeyId: v.IDENTITY_SIGNING_KEY_ID } : {}),
      accessTokenTtlSeconds: v.IDENTITY_ACCESS_TOKEN_TTL_SECONDS ?? 600,
      tokenIssuer: v.IDENTITY_TOKEN_ISSUER ?? 'https://api.komtru.com',
      tokenAudience: v.IDENTITY_TOKEN_AUDIENCE ?? 'komtru',
      epochCacheTtlSeconds: v.IDENTITY_EPOCH_CACHE_TTL_SECONDS ?? 10,
      ...(v.IDENTITY_HMAC_PEPPER ? { hmacPepper: v.IDENTITY_HMAC_PEPPER } : {}),
      breachCheckEnabled: v.IDENTITY_BREACH_CHECK_ENABLED ?? false,
      mirrorPhoneOtpToEmail: v.IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL ?? false,
    },
    terms: {
      ...(v.APP_TERMS_VERSION ? { version: v.APP_TERMS_VERSION } : {}),
      ...(v.APP_PRIVACY_VERSION ? { privacyVersion: v.APP_PRIVACY_VERSION } : {}),
    },
    paystack: {
      ...(v.PAYSTACK_SECRET_KEY ? { secretKey: v.PAYSTACK_SECRET_KEY } : {}),
      ...(v.PAYSTACK_PUBLIC_KEY ? { publicKey: v.PAYSTACK_PUBLIC_KEY } : {}),
    },
    sentry: {
      ...(v.SENTRY_DSN ? { dsn: v.SENTRY_DSN } : {}),
      environment: v.SENTRY_ENVIRONMENT ?? nodeEnv,
    },
    notify: notifyConfig(v, nodeEnv),
    socket: {
      enabled: v.SOCKET_ENABLED ?? true,
      path: v.SOCKET_PATH ?? '/socket.io',
      corsOrigins: v.SOCKET_CORS_ORIGINS ?? v.ALLOWED_ORIGINS ?? [],
      revalidateIntervalSeconds: v.SOCKET_REVALIDATE_INTERVAL_SECONDS ?? 30,
      credentialGraceSeconds: v.SOCKET_CREDENTIAL_GRACE_SECONDS ?? 60,
    },
    files: filesConfig(v),
    trust: trustConfig(v),
  };
}

/** M6's slice. The production guard on `provider` is in `loadConfig`, where the cross-field checks live. */
function trustConfig(v: Parsed): TrustConfig {
  const { DOJAH_APP_ID: appId, DOJAH_SECRET_KEY: secretKey, DOJAH_BASE_URL: baseUrl } = v;
  return {
    provider: v.TRUST_KYC_PROVIDER ?? 'FAKE',
    requestTtlMinutes: v.TRUST_REQUEST_TTL_MINUTES ?? TRUST_REQUEST_TTL_MINUTES,
    ...(appId && secretKey && baseUrl ? { dojah: { appId, secretKey, baseUrl } } : {}),
  };
}

/**
 * A day. Long enough for a provider that queues a liveness check for human review on its own side
 * (D4), short enough that a stalled request does not hold the user's one in-flight slot for a week.
 */
const TRUST_REQUEST_TTL_MINUTES = 1440;

/**
 * The five Cloudinary accounts M20 D5 names, in rotation order for the trade-asset pool.
 *
 * Exported because the module's seed reconciles `storage_accounts` against exactly this list, and a
 * sixth account is deliberately not expressible here — that is the §5 runbook, through
 * `POST /internal/storage-accounts`, which D6 promises needs no deploy.
 */
/** M20 §5's thresholds. Placeholders to tune once real volume exists, as the spec says. */
const QUOTA_NEAR_PCT = 85;
const QUOTA_DISABLED_PCT = 97;

export const CLOUDINARY_PREFIXES = [
  'CLOUDINARY_PROFILE',
  'CLOUDINARY_CHAT',
  'CLOUDINARY_TRADE_1',
  'CLOUDINARY_TRADE_2',
  'CLOUDINARY_TRADE_3',
] as const;

export type CloudinaryPrefix = (typeof CLOUDINARY_PREFIXES)[number];

function filesConfig(v: Parsed): FilesConfig {
  const accounts: Record<string, CloudinaryCredentials> = {};
  for (const prefix of CLOUDINARY_PREFIXES) {
    const cloudName = v[`${prefix}_CLOUD_NAME`];
    const apiKey = v[`${prefix}_API_KEY`];
    const apiSecret = v[`${prefix}_API_SECRET`];
    // All three or none. Two out of three signs uploads with an empty secret, which Cloudinary
    // answers with a 401 that names nothing the operator can act on.
    if (cloudName && apiKey && apiSecret) accounts[prefix] = { cloudName, apiKey, apiSecret };
  }
  return {
    accounts,
    maxUploadBytes: v.FILES_MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024,
    uploadTicketTtlMinutes: v.FILES_UPLOAD_TICKET_TTL_MINUTES ?? 30,
    signedUrlTtlSeconds: v.FILES_SIGNED_URL_TTL_SECONDS ?? 300,
    quota: {
      nearPct: v.FILES_QUOTA_NEAR_PCT ?? QUOTA_NEAR_PCT,
      disabledPct: v.FILES_QUOTA_DISABLED_PCT ?? QUOTA_DISABLED_PCT,
    },
  };
}

function notifyConfig(v: Parsed, nodeEnv: (typeof NODE_ENVS)[number]): NotifyConfig {
  const mailjet =
    v.MAILJET_API_KEY && v.MAILJET_API_SECRET && v.MAILJET_FROM_EMAIL
      ? {
          apiKey: v.MAILJET_API_KEY,
          apiSecret: v.MAILJET_API_SECRET,
          fromEmail: v.MAILJET_FROM_EMAIL,
          fromName: v.MAILJET_FROM_NAME ?? 'Komtru',
          // Defaults to sandbox: an incomplete configuration must never be the one that sends.
          sandbox: v.MAILJET_SANDBOX ?? true,
        }
      : undefined;
  const termii =
    v.TERMII_API_KEY && v.TERMII_SENDER_ID && v.TERMII_BASE_URL
      ? { apiKey: v.TERMII_API_KEY, senderId: v.TERMII_SENDER_ID, baseUrl: v.TERMII_BASE_URL }
      : undefined;
  const fcm =
    v.FCM_PROJECT_ID && v.FCM_SERVICE_ACCOUNT_JSON
      ? {
          projectId: v.FCM_PROJECT_ID,
          clientEmail: v.FCM_SERVICE_ACCOUNT_JSON.client_email,
          privateKey: v.FCM_SERVICE_ACCOUNT_JSON.private_key,
          tokenUri: v.FCM_SERVICE_ACCOUNT_JSON.token_uri,
        }
      : undefined;

  return {
    defaultLocale: v.NOTIFY_DEFAULT_LOCALE ?? 'en-NG',
    maxAttempts: v.NOTIFY_MAX_ATTEMPTS ?? 5,
    retryBaseDelayMs: v.NOTIFY_RETRY_BASE_DELAY_MS ?? 2_000,
    rateLimitWindowMinutes: v.NOTIFY_RATE_LIMIT_WINDOW_MINUTES ?? 60,
    rateLimitMaxPerWindow: v.NOTIFY_RATE_LIMIT_MAX_PER_WINDOW ?? 20,
    smsDryRun: v.NOTIFY_SMS_DRY_RUN ?? nodeEnv !== 'production',
    pushDryRun: v.NOTIFY_PUSH_DRY_RUN ?? nodeEnv !== 'production',
    ...(mailjet ? { mailjet } : {}),
    ...(termii ? { termii } : {}),
    ...(fcm ? { fcm } : {}),
  };
}
