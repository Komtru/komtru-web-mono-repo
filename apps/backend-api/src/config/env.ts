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
  notify: NotifyConfig;
}

/** M11's tuning, and one block per provider. A block is absent until its credentials are complete. */
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
    sentry: {
      ...(v.SENTRY_DSN ? { dsn: v.SENTRY_DSN } : {}),
      environment: v.SENTRY_ENVIRONMENT ?? nodeEnv,
    },
    notify: notifyConfig(v, nodeEnv),
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
