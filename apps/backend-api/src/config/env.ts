// Backend configuration, parsed once at boot from the environment.
//
// SECURITY: the backend's .env holds live credentials. Errors from this module name the variables that
// are missing or invalid, never their values.
import { z } from 'zod';

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
  redis: { url: string };
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
  };
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
    redis: { url: v.REDIS_URL as string },
    crypto: { ...(v.ENCRYPTION_KEY ? { encryptionKey: v.ENCRYPTION_KEY } : {}) },
    scheduler: { timezone: v.SCHEDULER_TIMEZONE ?? 'Africa/Lagos' },
    identity: {
      ...(v.IDENTITY_SIGNING_KEY ? { signingKey: v.IDENTITY_SIGNING_KEY } : {}),
      ...(v.IDENTITY_SIGNING_KEY_ID ? { signingKeyId: v.IDENTITY_SIGNING_KEY_ID } : {}),
      accessTokenTtlSeconds: v.IDENTITY_ACCESS_TOKEN_TTL_SECONDS ?? 600,
      tokenIssuer: v.IDENTITY_TOKEN_ISSUER ?? 'https://api.komtru.com',
      tokenAudience: v.IDENTITY_TOKEN_AUDIENCE ?? 'komtru',
      epochCacheTtlSeconds: v.IDENTITY_EPOCH_CACHE_TTL_SECONDS ?? 10,
    },
    sentry: {
      ...(v.SENTRY_DSN ? { dsn: v.SENTRY_DSN } : {}),
      environment: v.SENTRY_ENVIRONMENT ?? nodeEnv,
    },
  };
}
