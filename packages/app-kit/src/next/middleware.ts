// The middleware every Komtru app exports. It answers one question on every navigation: does the
// visitor hold a session of the scope this app requires?
//
// **What this is and is not.** It is a redirect, not an authorization boundary. The real check is
// the backend's: every API call carries an access token the backend validates against the scope the
// route declares, and nothing a browser sends can forge that. What this buys is that a person
// without a STAFF session never sees the TrustOps console's shell at all, and that someone who
// signed in at the wrong host is told where to go instead of meeting an empty screen full of 403s.
// The hint it reads is HMAC-sealed (`../session.ts`) precisely so that answer is real rather than
// whatever the request's cookie header claims.
import { NextResponse, type NextRequest } from 'next/server';
import type { AppConfig } from '../config.js';
import { clearedCookies, secureCookieFor, SESSION_COOKIE, type SessionSealer } from '../session.js';

export interface KomtruMiddlewareOptions {
  config: AppConfig;
  sealer: SessionSealer;
  /**
   * Paths that need no session, matched on whole segments: `/passport` covers `/passport/zaza` and
   * not `/passportage`. The app's sign-in path is always one of them.
   */
  publicPaths?: readonly string[];
  now?: () => number;
}

/**
 * The extensions a Komtru app serves as files. An allowlist, not "anything after a dot": a path
 * segment may legitimately contain one.
 */
const ASSET_EXTENSIONS = [
  'css',
  'js',
  'mjs',
  'map',
  'json',
  'txt',
  'xml',
  'webmanifest',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'ico',
  'bmp',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp4',
  'webm',
  'pdf',
];
const ASSET_PATTERN = `.*\\.(?:${ASSET_EXTENSIONS.join('|')})$`;

/**
 * What a template's `export const config = { matcher: KOMTRU_MATCHER }` uses. Next never runs
 * middleware for anything this excludes, which keeps a page's own chunks and images off the hot
 * path. `middleware()` re-checks the same exclusions anyway: an app that narrows the matcher for
 * its own reasons must not thereby start redirecting its stylesheet.
 */
export const KOMTRU_MATCHER = [`/((?!_next/|favicon\\.ico$|${ASSET_PATTERN}).*)`] as const;

const AUTH_ROUTES = '/api/auth';

const isSegmentPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * A chunk, an image, a font — decided by the same expression the matcher uses, so the two can never
 * disagree. The naive `.*\..*` reads as "has an extension" and means "has a dot anywhere": it
 * exempts `/trades/KMT-1.2`, `/u/jane.doe` and `/settings/v1.5` from the session check entirely.
 */
const isAsset = (pathname: string): boolean =>
  isSegmentPrefix(pathname, '/_next') ||
  pathname === '/favicon.ico' ||
  new RegExp(`^/${ASSET_PATTERN}$`).test(pathname);

export function createKomtruMiddleware({
  config,
  sealer,
  publicPaths = [],
  now = Date.now,
}: KomtruMiddlewareOptions): (request: NextRequest) => Promise<NextResponse> {
  const open = [config.signInPath, ...publicPaths];

  return async (request: NextRequest): Promise<NextResponse> => {
    const { pathname, search } = request.nextUrl;

    // The route handlers are the only way to *get* a session, so they can never need one.
    if (isSegmentPrefix(pathname, AUTH_ROUTES)) return NextResponse.next();
    if (isAsset(pathname)) return NextResponse.next();
    if (open.some((prefix) => isSegmentPrefix(pathname, prefix))) return NextResponse.next();

    const hint = await sealer.open(request.cookies.get(SESSION_COOKIE)?.value, now());

    if (hint === null) {
      const target = `${pathname}${search}`;
      return reject(
        request,
        new URL(config.signInPath, request.nextUrl.origin),
        isSameSitePath(target) ? { next: target } : {},
      );
    }

    if (hint.scope !== config.scope) {
      // A Park Agent who signed in at logistics.komtru.com, a consumer who landed on ops: send them
      // to the app their session actually belongs to rather than to a sign-in they will fail again.
      const target =
        config.elsewhereUrl === undefined
          ? new URL(config.signInPath, request.nextUrl.origin)
          : new URL('/', config.elsewhereUrl);
      return reject(request, target, config.elsewhereUrl === undefined ? { error: 'wrong-scope' } : {});
    }

    return NextResponse.next();
  };
}

/**
 * Every rejection clears both cookies. A session this app will never accept is not worth keeping:
 * left in place it would be re-read, re-rejected and re-redirected on every navigation, and the
 * sign-in page itself would be sitting behind a cookie that says the visitor is someone else.
 */
/**
 * `new URL('//evil.com/x', 'https://app.komtru.com')` resolves to `https://evil.com/x`, so a path
 * beginning with two slashes — or a backslash, which browsers normalise to one — turns the obvious
 * `router.replace(next)` on a sign-in screen into an open redirect. The producer does not hand out a
 * value the consumer has to defend against: anything that is not plainly a path on this host is
 * dropped, and the visitor lands on the app's home instead.
 */
const isSameSitePath = (value: string): boolean =>
  value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');

function reject(request: NextRequest, target: URL, query: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  const response = NextResponse.redirect(target, 307);
  const secure = secureCookieFor(new URL(request.url));
  for (const cookie of clearedCookies(secure)) response.cookies.set(cookie);
  return response;
}
