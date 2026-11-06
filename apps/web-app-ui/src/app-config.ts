// What this app states about itself, for `@komtru/app-kit`. Committed, not configured: the scope is
// a property of the product, not of the environment.
//
// Everyone who buys or sells is a CONSUMER session (design C22, §7.3). There is no buyer or seller
// scope, and no role switcher.
import { publicEnv, readAppConfig, type AppConfig, type AppEnv, type AppSpec } from '@komtru/app-kit';
import type { HostRules } from './hosts';

export const appSpec = {
  appName: 'web-app-ui',
  scope: 'CONSUMER',
  signInPath: '/sign-in',
  // Buy mode's landing (`landingFor('buy')`); `app/page.tsx` sends Sell mode to `/shop`.
  homePath: '/home',
} as const satisfies AppSpec;

/** Where the public Trust Passport pages are served. Its own host in production (design C12). */
export const PASSPORT_URL_ENV = 'NEXT_PUBLIC_KOMTRU_PASSPORT_URL';
/** `park.komtru.com` — the Park Agent app an active agent is sent to from Account (design §7.6). */
export const PARK_URL_ENV = 'NEXT_PUBLIC_KOMTRU_PARK_URL';

/**
 * `AppConfig` plus the two URLs only this app has, which together are exactly the `HostRules`
 * `middleware` routes by — so the config object is the rules, rather than something a caller has to
 * assemble into them.
 *
 * `passportUrl` may carry a path: locally the passport pages are `http://localhost:3001/passport`
 * on this very app, and in production `https://passport.komtru.com` on a host of their own. Both
 * are the same routes; `routeRequest` decides which of the two shapes a request is in.
 */
export interface WebAppConfig extends AppConfig, HostRules {}

/**
 * The public environment, written as literal member expressions for the same reason
 * `publicEnv` is: Next inlines `process.env.NEXT_PUBLIC_X` into the client bundle one literal at a
 * time and never defines `process.env` itself.
 */
export const webAppEnv = (): AppEnv =>
  publicEnv({
    NEXT_PUBLIC_KOMTRU_PASSPORT_URL: process.env.NEXT_PUBLIC_KOMTRU_PASSPORT_URL,
    NEXT_PUBLIC_KOMTRU_PARK_URL: process.env.NEXT_PUBLIC_KOMTRU_PARK_URL,
  });

const trimmed = (env: AppEnv, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
};

/** Trailing slash off, so `${parkUrl}/log-arrival` never becomes `//log-arrival`. */
const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const readUrl = (env: AppEnv, name: string, errors: string[]): string => {
  const value = trimmed(env, name);
  if (value === undefined) {
    errors.push(`${name} is missing`);
    return '';
  }
  if (!URL.canParse(value)) {
    errors.push(`${name} is not a valid URL`);
    return '';
  }
  return withoutTrailingSlash(value);
};

const required = (env: AppEnv, name: string): string => {
  const errors: string[] = [];
  const value = readUrl(env, name, errors);
  if (errors.length > 0) throw new Error(`${appSpec.appName}: ${errors.join('; ')}`);
  return value;
};

/**
 * Where the Park Agent app lives. Read on its own because Account is the only screen that needs it:
 * a deployment missing it should cost the Park Agent row, not sign-in and not error reporting.
 */
export const readParkUrl = (env: AppEnv): string => required(env, PARK_URL_ENV);

/** Where the passport pages are served. Only the host rules need it. */
export const readPassportUrl = (env: AppEnv): string => required(env, PASSPORT_URL_ENV);

/**
 * `readAppConfig` plus the two URLs only this app has, which together are exactly the `HostRules`.
 *
 * Only `middleware` asks for all of it, because only `middleware` routes by all of it. Everything
 * else reads the one value it uses: the auth route and `instrumentation` take `readAppConfig`, and
 * Account takes `readParkUrl`. A deployment with no `NEXT_PUBLIC_KOMTRU_PARK_URL` should not be a
 * deployment with no login.
 */
export function readWebAppConfig(env: AppEnv): WebAppConfig {
  const base = readAppConfig(appSpec, env);
  const errors: string[] = [];

  // Both read before either is reported: fixing `.env.local` one restart at a time is the slowest
  // possible way to learn that two of them are wrong.
  const passportUrl = readUrl(env, PASSPORT_URL_ENV, errors);
  const parkUrl = readUrl(env, PARK_URL_ENV, errors);
  if (errors.length > 0) throw new Error(`${appSpec.appName}: ${errors.join('; ')}`);

  return { ...base, passportUrl, parkUrl };
}
