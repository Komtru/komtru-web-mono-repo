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
 * What a template's `export const config = { matcher: KOMTRU_MATCHER }` uses. Next never runs
 * middleware for anything this excludes, which keeps a page's own chunks and images off the hot
 * path. `middleware()` re-checks the same exclusions anyway: an app that narrows the matcher for
 * its own reasons must not thereby start redirecting its stylesheet.
 */
export const KOMTRU_MATCHER = ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'] as const;

const AUTH_ROUTES = '/api/auth';

const isSegmentPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** A chunk, an image, a font: anything Next serves from `_next` or with a file extension. */
const isAsset = (pathname: string): boolean =>
  isSegmentPrefix(pathname, '/_next') || pathname === '/favicon.ico' || /\.[^/]+$/.test(pathname);

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
      return reject(request, new URL(config.signInPath, request.nextUrl.origin), {
        next: `${pathname}${search}`,
      });
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
function reject(request: NextRequest, target: URL, query: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  const response = NextResponse.redirect(target, 307);
  const secure = secureCookieFor(new URL(request.url));
  for (const cookie of clearedCookies(secure)) response.cookies.set(cookie);
  return response;
}
