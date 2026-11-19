/**
 * What the site needs from its environment, and what it does without.
 *
 * Every value here is a `NEXT_PUBLIC_*` one, written as a literal member expression because that is
 * the only form Next inlines into the browser bundle — `process.env[name]` reaches a `process.env`
 * that does not exist on the client.
 *
 * Read per call rather than at module scope: `next build` evaluates these modules on a machine
 * whose environment is not the deployment's.
 */

/** Trailing slash off, so `${appUrl}/login` never becomes `//login`. */
const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed.replace(/\/+$/, '');
};

/**
 * Where the consumer app lives. Every "Log in" and "Start a trade" button points here.
 *
 * Absent, the buttons fall back to `/waitlist`, which is the honest answer before launch: the app
 * is not open, and sending someone to a host that does not resolve says that far less clearly.
 */
export const appUrl = (): string | undefined => clean(process.env.NEXT_PUBLIC_KOMTRU_APP_URL);

/**
 * The backend, for the one call this site makes. Absent, the waitlist form keeps working and says
 * so — see `src/site/waitlist.ts`.
 */
export const apiUrl = (): string | undefined => clean(process.env.NEXT_PUBLIC_KOMTRU_API_URL);

/** This site's own origin, for canonical URLs and the QR code. */
export const siteUrl = (): string => clean(process.env.NEXT_PUBLIC_KOMTRU_SITE_URL) ?? 'https://komtru.com';

/**
 * Where a call to action goes.
 *
 * `login` and `signup` are the app's screens; before the app is open they are the waitlist, because
 * an account cannot be created yet and a dead link is worse than an honest one.
 */
export function appLink(path: '/login' | '/signup'): string {
  const base = appUrl();
  return base === undefined ? '/waitlist' : `${base}${path}`;
}
