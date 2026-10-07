// This app's session enforcement, plus the two host rules only it has.
//
// Order matters and is not arbitrary. A `/hub/*` operating URL has moved to another app and a
// passport page is public, so both are decided before anything asks for a session: sending a Park
// Agent to sign in here, or a buyer following a shared passport link, would be a redirect to the
// wrong answer.
//
// What this is and is not: a redirect, not an authorization boundary. The backend checks the access
// token's scope on every call, and that is the check that matters.
import { createKomtruMiddleware } from '@komtru/app-kit/next';
import { createSessionSealer, requireSessionSecret } from '@komtru/app-kit';
import { NextRequest, NextResponse } from 'next/server';
import { readWebAppConfig } from './src/app-config';
import { routeRequest } from './src/hosts';
import { PRE_AUTH_PUBLIC_PATHS, PUBLIC_PATHS } from './src/middleware-rules';

const appConfig = readWebAppConfig(process.env);

const requireSession = createKomtruMiddleware({
  config: appConfig,
  sealer: createSessionSealer(requireSessionSecret(process.env)),
  publicPaths: [...PUBLIC_PATHS, ...PRE_AUTH_PUBLIC_PATHS],
});

/**
 * The host the visitor actually asked for.
 *
 * Not `request.nextUrl.host`: under `next start` — this app's own start script — Next builds the
 * middleware URL from the origin the Node server is bound to, so `nextUrl.host` is always
 * `localhost:3001` and the passport rule never fired on any real deployment. The public host
 * arrives in a header. `x-forwarded-host` comes first because a load balancer puts the host the
 * visitor typed there and its own address in `Host`.
 */
const requestedHost = (request: NextRequest): string =>
  request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const route = routeRequest({ host: requestedHost(request), pathname, search }, appConfig);

  // 307 rather than 308: park-agent-app's own route names are T-170's to settle, and a permanent
  // redirect would sit in browsers' caches long after this mapping changed.
  if (route.kind === 'redirect') return NextResponse.redirect(route.url, 307);

  if (route.kind === 'rewrite') {
    // The gate is not skipped here. Which host this is was decided from a header the caller
    // controls, so returning the rewrite before asking about a session would put an authorization
    // decision behind a forgeable signal. Instead the gate runs on the path the rewrite will
    // serve: `/passport/*` is public, so a forged `Host` buys a visitor the pages that were
    // already public to everyone, and nothing more.
    const rewritten = new URL(`${route.pathname}${search}`, request.nextUrl.origin);
    const gated = await requireSession(new NextRequest(rewritten, request));
    return gated.headers.has('location') ? gated : NextResponse.rewrite(rewritten);
  }

  return requireSession(request);
}

/**
 * `KOMTRU_MATCHER`, written out.
 *
 * Next parses this object statically, out of the source, before any of it runs — so it accepts an
 * array literal of string literals and nothing else: a spread of the shared constant fails the
 * build with "Unsupported spread operator in the Array Expression". `test/middleware.test.ts`
 * compares this literal against `KOMTRU_MATCHER` so the copy cannot drift from the original.
 */
export const config = {
  matcher: [
    '/((?!_next/|favicon\\.ico$|.*\\.(?:css|js|mjs|map|json|txt|xml|webmanifest|png|jpg|jpeg|gif|svg|webp|avif|ico|bmp|woff|woff2|ttf|otf|eot|mp4|webm|pdf)$).*)',
  ],
};
