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
import { NextResponse, type NextRequest } from 'next/server';
import { readWebAppConfig } from './src/app-config';
import { routeRequest } from './src/hosts';
import { PRE_AUTH_PUBLIC_PATHS, PUBLIC_PATHS } from './src/middleware-rules';

const appConfig = readWebAppConfig(process.env);

const requireSession = createKomtruMiddleware({
  config: appConfig,
  sealer: createSessionSealer(requireSessionSecret(process.env)),
  publicPaths: [...PUBLIC_PATHS, ...PRE_AUTH_PUBLIC_PATHS],
});

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const { host, pathname, search } = request.nextUrl;
  const route = routeRequest({ host, pathname, search }, appConfig);

  // 307 rather than 308: park-agent-app's own route names are T-170's to settle, and a permanent
  // redirect would sit in browsers' caches long after this mapping changed.
  if (route.kind === 'redirect') return NextResponse.redirect(route.url, 307);

  // A passport page is public by definition, so there is nothing further to ask about it.
  if (route.kind === 'rewrite') {
    return NextResponse.rewrite(new URL(`${route.pathname}${search}`, request.nextUrl.origin));
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
