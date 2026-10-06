// Two routing rules this app has that no other Komtru app does, both from the design reference's
// own URLs and both decided before anything looks at a session:
//
//   1. `passport.komtru.com/<slug>` is the public Trust Passport. It is a host, not an app: the
//      pages are this app's `/passport/*` routes, rewritten so the URL a seller shares carries no
//      app path. Locally there is no second host, so the same pages are reached at `/passport/*`
//      directly and nothing is rewritten.
//   2. `app.komtru.com/hub/*` is where the reference drew the Park Agent's operating screens. Design
//      C12 moved those to `park.komtru.com` and kept only the *application* flow here, so the
//      operating URLs redirect out and `/hub/register` and `/hub/application` stay.
//
// Plain functions over `{ host, pathname, search }` rather than `NextRequest`: this is the part
// worth testing, and nothing here needs the Edge runtime to say what it decides.

/** The routes behind the passport host. A constant of this app, not of the environment. */
export const PASSPORT_ROUTE_PREFIX = '/passport';

/** `/hub/*` paths that belong to a consumer and stay in this app (design §7.6). */
export const HUB_APPLICATION_PATHS = ['/hub/register', '/hub/application'] as const;

const HUB_PREFIX = '/hub';

/** Served as files or handlers, so never a profile slug however the host asked for it. */
const NEVER_A_PROFILE = ['/api', '/_next'];
const NEVER_A_PROFILE_FILE = /^\/[^/]+\.[A-Za-z0-9]+$/;

export interface HostRules {
  /** This app's own origin. */
  readonly appUrl: string;
  /** Where the passport pages are served — its own host in production, a path on this app locally. */
  readonly passportUrl: string;
  /** The Park Agent app's origin. */
  readonly parkUrl: string;
}

export type HostRoute =
  /** Serve this app, as asked. */
  | { kind: 'app' }
  /** Serve a different path of this app without changing the URL in the browser. */
  | { kind: 'rewrite'; pathname: string }
  /** Send the visitor to another app. */
  | { kind: 'redirect'; url: string };

export interface IncomingRequest {
  /** Host and port, as the request carried it. */
  host: string;
  pathname: string;
  /** Including the leading `?`, or empty. */
  search: string;
}

const isSegmentPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const hostOf = (url: string): string | undefined => (URL.canParse(url) ? new URL(url).host : undefined);

export function routeRequest(request: IncomingRequest, rules: HostRules): HostRoute {
  const { host, pathname, search } = request;

  if (isSegmentPrefix(pathname, HUB_PREFIX)) {
    if (HUB_APPLICATION_PATHS.some((prefix) => isSegmentPrefix(pathname, prefix))) return { kind: 'app' };
    // 307, not 308, at the call site: park-agent-app's own route names are T-170's to settle, and a
    // permanent redirect would be cached in browsers long after this mapping changed.
    const rest = pathname.slice(HUB_PREFIX.length);
    return { kind: 'redirect', url: `${rules.parkUrl}${rest === '' ? '/' : rest}${search}` };
  }

  const passportHost = hostOf(rules.passportUrl);
  const onPassportHost =
    passportHost !== undefined && passportHost === host && passportHost !== hostOf(rules.appUrl);

  if (onPassportHost && !isSegmentPrefix(pathname, PASSPORT_ROUTE_PREFIX)) {
    if (NEVER_A_PROFILE.some((prefix) => isSegmentPrefix(pathname, prefix))) return { kind: 'app' };
    if (NEVER_A_PROFILE_FILE.test(pathname)) return { kind: 'app' };
    const rest = pathname === '/' ? '' : pathname;
    return { kind: 'rewrite', pathname: `${PASSPORT_ROUTE_PREFIX}${rest}` };
  }

  return { kind: 'app' };
}
