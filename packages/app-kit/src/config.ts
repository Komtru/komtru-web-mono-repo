// Every Komtru Next app reads its environment through here, so a misconfigured app says which line
// of `.env.local` is wrong rather than failing later with an undefined URL in a fetch.
//
// Only `NEXT_PUBLIC_*` values live on `AppConfig`. The session secret is deliberately absent: this
// object is handed to client components, and a secret on it would be in the browser bundle.
import type { SessionScope } from '@komtru/shared-types';
import { z } from 'zod';

/** What an app states about itself. Static — it is committed, not configured. */
export interface AppSpec {
  /** The workspace directory name, used as the Sentry tag. */
  readonly appName: string;
  /** The session scope this app's middleware requires (design §7.3). */
  readonly scope: SessionScope;
  readonly signInPath?: string;
  readonly homePath?: string;
  /**
   * The env var naming the app a session of *another* scope belongs to — a Park Agent who signs in
   * at logistics.komtru.com, a consumer who lands on ops.komtru.com. Omitted, a wrong-scope session
   * is sent to this app's own sign-in instead.
   */
  readonly elsewhereUrlEnv?: string;
}

export interface AppConfig {
  readonly appName: string;
  readonly scope: SessionScope;
  readonly appUrl: string;
  /** Includes the `/v1` prefix every backend route is mounted under. */
  readonly apiUrl: string;
  readonly socketUrl: string | undefined;
  readonly sentryDsn: string | undefined;
  readonly signInPath: string;
  readonly homePath: string;
  readonly elsewhereUrl: string | undefined;
}

export const APP_URL_ENV = 'NEXT_PUBLIC_KOMTRU_APP_URL';
export const API_URL_ENV = 'NEXT_PUBLIC_KOMTRU_API_URL';
export const SOCKET_URL_ENV = 'NEXT_PUBLIC_KOMTRU_SOCKET_URL';
export const SENTRY_DSN_ENV = 'NEXT_PUBLIC_SENTRY_DSN';

export type AppEnv = Record<string, string | undefined>;

const url = z.url();
const optionalUrl = url.optional();

/** `.env.example` ships `NEXT_PUBLIC_SENTRY_DSN=` empty, and an empty string is not a DSN. */
const blankIsAbsent = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim();

const read = (env: AppEnv, name: string, schema: z.ZodType<string | undefined>): string | undefined => {
  const parsed = schema.safeParse(blankIsAbsent(env[name]));
  if (parsed.success) return parsed.data;
  // One line per variable, named. A zod issue tree printed at a developer who typed a URL wrong is
  // an invitation to go and read this file instead of fixing the line.
  throw new Error(`${name} is ${env[name] === undefined ? 'missing' : 'not a valid URL'}`);
};

/** Trailing slash off, so `${apiUrl}/auth/login` never becomes `//auth/login`. */
const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export function readAppConfig(spec: AppSpec, env: AppEnv): AppConfig {
  const errors: string[] = [];
  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  };

  const appUrl = attempt(() => read(env, APP_URL_ENV, url));
  const apiUrl = attempt(() => read(env, API_URL_ENV, url));
  const socketUrl = attempt(() => read(env, SOCKET_URL_ENV, optionalUrl));
  const elsewhereUrl =
    spec.elsewhereUrlEnv === undefined
      ? undefined
      : attempt(() => read(env, spec.elsewhereUrlEnv!, optionalUrl));

  // Every bad variable in one message: fixing `.env.local` one restart at a time is the slowest
  // possible way to learn that three of them are wrong.
  if (errors.length > 0) throw new Error(`${spec.appName}: ${errors.join('; ')}`);

  return {
    appName: spec.appName,
    scope: spec.scope,
    appUrl: withoutTrailingSlash(appUrl!),
    apiUrl: withoutTrailingSlash(apiUrl!),
    socketUrl,
    sentryDsn: blankIsAbsent(env[SENTRY_DSN_ENV]),
    signInPath: spec.signInPath ?? '/sign-in',
    homePath: spec.homePath ?? '/',
    elsewhereUrl,
  };
}
