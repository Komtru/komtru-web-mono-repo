/**
 * Which site a signup came from.
 *
 * Komtru runs one backend. The marketing site and the app both call it, from different hosts, and
 * before launch that is a deliberate saving rather than an accident: a second API process would
 * need its own checkout and `node_modules` on a box whose disk is the binding constraint. So the
 * row records where it came in from, and "the launch list" is the rows tagged `PROD`.
 *
 * WHAT THIS IS NOT. `Origin` is set by the browser and cannot be changed by the page's own
 * JavaScript, and the CORS allowlist means a browser will not even send the request from a host
 * that is not named there. But anything that is not a browser can send any `Origin` it likes, so
 * this is a SIGNAL and never an authenticator — the same standing the platform gives a device
 * fingerprint. Nothing is granted or refused on the strength of it; it only says which list a name
 * belongs on, and nobody gains anything by lying about that.
 */

export const WAITLIST_SOURCES = ['PROD', 'STAGING', 'PREVIEW', 'LOCAL', 'UNKNOWN'] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

/** Exact origins, lower-cased. A host not listed here is not silently treated as production. */
const KNOWN: ReadonlyMap<string, WaitlistSource> = new Map([
  ['https://komtru.com', 'PROD'],
  ['https://www.komtru.com', 'PROD'],
  ['https://staging.komtru.com', 'STAGING'],
  ['https://staging-www.komtru.com', 'STAGING'],
  ['http://localhost:3005', 'LOCAL'],
  ['http://127.0.0.1:3005', 'LOCAL'],
]);

/** Vercel builds every branch and pull request on a generated host; they are all previews. */
const PREVIEW_HOST = /\.vercel\.app$/;

/**
 * Read the source from a request's `Origin`.
 *
 * Absent or unrecognised is `UNKNOWN`, not `PROD`. A missing header means the caller was not a
 * browser — a health probe, a curl, something server-side — and filing those under production
 * would quietly inflate the only number this column exists to produce.
 */
export function readSource(origin: string | undefined): WaitlistSource {
  const value = origin?.trim().toLowerCase();
  if (value === undefined || value === '' || value === 'null') return 'UNKNOWN';

  const known = KNOWN.get(value.replace(/\/+$/, ''));
  if (known !== undefined) return known;

  if (!URL.canParse(value)) return 'UNKNOWN';
  return PREVIEW_HOST.test(new URL(value).hostname) ? 'PREVIEW' : 'UNKNOWN';
}
