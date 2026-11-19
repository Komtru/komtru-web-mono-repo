// The canned platform API. It answers the routes the frontends call, from `fixtures.ts`, and nothing else:
// no database, no Redis, no backend process. A route it does not know answers 404 and is logged as
// UNMATCHED, which is how a ticket finds out what its screen needs next.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { checkFixtures } from './contracts.ts';
import {
  addressesFor,
  disputeDetailFor,
  disputeEvidenceFor,
  disputesFor,
  deliveryDeadlineFor,
  disputeTimelineFor,
  evidenceComparisonFor,
  fileFor,
  inspectionFor,
  meFor,
  merchantApplicationFor,
  paymentStatusFor,
  payoutAccountsFor,
  tradeActivityFor,
  payoutSummaryFor,
  payoutsFor,
  shipOptionsFor,
  tradeDisputeFor,
  tradeEvidenceFor,
  tradeFor,
  tradeStandardFor,
  tradesFor,
  verificationStatusFor,
  viewerFactsFor,
} from './fixtures.ts';
import { accessTokenFor, readBearer, readRefreshToken, refreshTokenFor, type Identity } from './identity.ts';

export const STANDIN_DEFAULT_PORT = 7913;

export interface Reply {
  status: number;
  body?: unknown;
}

/** The `:name` segments of a route's path, by name. */
type Params = Readonly<Record<string, string>>;

/** A route the apps call without a session: the refresh token in the body is its own proof. */
type PublicRoute = {
  method: 'POST';
  path: string;
  kind: 'public';
  handle: (body: unknown) => Reply;
};

/** A route the apps call with a bearer token from a consumer session. */
type ConsumerRoute = {
  method: 'GET';
  path: string;
  kind: 'consumer';
  handle: (identity: Identity, params: Params, query: URLSearchParams) => Reply;
};

/** A public read, which the apps call with no session (a trade standard is published to everyone). */
type AnonymousRoute = {
  method: 'GET';
  path: string;
  kind: 'anonymous';
  handle: (params: Params) => Reply;
};

const ACCESS_LIFETIME_MS = 15 * 60 * 1000;

const problem = (status: number, title: string, detail?: string): Reply => ({
  status,
  body: { type: 'about:blank', title, status, ...(detail === undefined ? {} : { detail }) },
});

/** A list the app pages through. The fixtures fit on one page, so the cursor is always null. */
const page = (items: unknown[]): Reply => ({ status: 200, body: { items, nextCursor: null } });

const ROUTES: readonly (PublicRoute | ConsumerRoute | AnonymousRoute)[] = [
  {
    method: 'POST',
    path: '/auth/refresh',
    kind: 'public',
    handle: (body) => {
      const refreshToken = (body as { refreshToken?: unknown } | null | undefined)?.refreshToken;
      const identity = readRefreshToken(refreshToken);
      if (identity === null) return problem(401, 'Refresh token not minted by the visual-check stand-in');
      return {
        status: 200,
        body: {
          accessToken: accessTokenFor(identity.persona, identity.scenario, Date.now()),
          // Rotated the way the backend rotates: same persona and scenario, so the cookie keeps working.
          refreshToken: refreshTokenFor(identity.persona, identity.scenario),
          scope: identity.persona.scope,
          expiresIn: ACCESS_LIFETIME_MS / 1000,
          expiresAt: Date.now() + ACCESS_LIFETIME_MS,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/me/viewer',
    kind: 'consumer',
    handle: ({ persona }) => ({ status: 200, body: viewerFactsFor(persona.id) }),
  },
  {
    method: 'GET',
    path: '/me',
    kind: 'consumer',
    handle: ({ persona, scenario }) => ({ status: 200, body: meFor(persona.id, scenario) }),
  },
  {
    method: 'GET',
    path: '/merchant/applications/me',
    kind: 'consumer',
    handle: ({ persona, scenario }) => ({
      status: 200,
      body: merchantApplicationFor(persona.id, scenario),
    }),
  },
  {
    method: 'GET',
    path: '/trades',
    kind: 'consumer',
    handle: ({ persona, scenario }) => page(tradesFor(persona.id, scenario)),
  },
  {
    method: 'GET',
    path: '/trades/:id',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const trade = tradeFor(persona.id, scenario, id ?? '');
      return trade === null ? problem(404, 'Trade not found', id) : { status: 200, body: trade };
    },
  },
  {
    method: 'GET',
    path: '/trades/:id/dispute',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const tradeId = id ?? '';
      // The case is read from a trade the person can see; a trade that is not theirs is not found, not empty.
      if (tradeFor(persona.id, scenario, tradeId) === null) return problem(404, 'Trade not found', tradeId);
      return { status: 200, body: tradeDisputeFor(persona.id, scenario, tradeId) };
    },
  },
  {
    method: 'GET',
    path: '/trades/:id/payment/status',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const status = paymentStatusFor(persona.id, scenario, id ?? '');
      return status === null ? problem(404, 'Trade not found', id) : { status: 200, body: status };
    },
  },
  {
    method: 'GET',
    path: '/trades/:id/inspection',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const inspection = inspectionFor(persona.id, scenario, id ?? '');
      return inspection === null ? problem(404, 'Trade not found', id) : { status: 200, body: inspection };
    },
  },
  {
    method: 'GET',
    path: '/verification/status',
    kind: 'consumer',
    handle: ({ persona }) => ({ status: 200, body: verificationStatusFor(persona.id) }),
  },
  {
    method: 'GET',
    path: '/me/payout-accounts',
    kind: 'consumer',
    handle: ({ persona }) => ({ status: 200, body: { accounts: payoutAccountsFor(persona.id) } }),
  },
  {
    method: 'GET',
    path: '/me/addresses',
    kind: 'consumer',
    handle: ({ persona }) => page(addressesFor(persona.id)),
  },
  {
    method: 'GET',
    path: '/config/trade-standards/versions/:id',
    kind: 'anonymous',
    handle: ({ id }) => {
      const standard = tradeStandardFor(id ?? '');
      return standard === null
        ? problem(404, 'Trade standard version not found', id)
        : { status: 200, body: standard };
    },
  },
  {
    method: 'GET',
    path: '/disputes',
    kind: 'consumer',
    handle: ({ persona, scenario }) => page(disputesFor(persona.id, scenario)),
  },
  {
    method: 'GET',
    path: '/disputes/:id',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const detail = disputeDetailFor(persona.id, scenario, id ?? '');
      return detail === null ? problem(404, 'Dispute not found', id) : { status: 200, body: detail };
    },
  },
  {
    method: 'GET',
    path: '/disputes/:id/timeline',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const entries = disputeTimelineFor(persona.id, scenario, id ?? '');
      return entries === null ? problem(404, 'Dispute not found', id) : page(entries);
    },
  },
  {
    method: 'GET',
    path: '/disputes/:id/evidence',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const evidence = disputeEvidenceFor(persona.id, scenario, id ?? '');
      return evidence === null ? problem(404, 'Dispute not found', id) : page(evidence);
    },
  },
  {
    method: 'GET',
    path: '/disputes/:id/evidence-comparison',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const comparison = evidenceComparisonFor(persona.id, scenario, id ?? '');
      return comparison === null ? problem(404, 'Dispute not found', id) : { status: 200, body: comparison };
    },
  },
  // F-069/F-073 fulfil & payouts
  {
    method: 'GET',
    path: '/me/payouts/summary',
    kind: 'consumer',
    handle: ({ persona }) => ({ status: 200, body: payoutSummaryFor(persona.id) }),
  },
  {
    method: 'GET',
    path: '/me/payouts',
    kind: 'consumer',
    handle: ({ persona }) => page(payoutsFor(persona.id)),
  },
  {
    method: 'GET',
    path: '/trades/:id/ship-options',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const options = shipOptionsFor(persona.id, scenario, id ?? '');
      return options === null
        ? problem(409, 'This trade is not waiting to be shipped', id)
        : { status: 200, body: options };
    },
  },
  // F-069/F-073 deliver & inspect
  {
    method: 'GET',
    path: '/trades/:id/delivery-deadline',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const read = deliveryDeadlineFor(persona.id, scenario, id ?? '');
      return read === null ? problem(404, 'Trade not found', id) : { status: 200, body: read };
    },
  },
  {
    method: 'GET',
    path: '/trades/:id/activity',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }) => {
      const activity = tradeActivityFor(persona.id, scenario, id ?? '');
      return activity === null ? problem(404, 'Trade not found', id) : { status: 200, body: activity };
    },
  },
  {
    method: 'GET',
    path: '/trades/:id/evidence',
    kind: 'consumer',
    handle: ({ persona, scenario }, { id }, query) => {
      const items = tradeEvidenceFor(persona.id, scenario, id ?? '', query.get('event'));
      return items === null ? problem(404, 'Trade not found', id) : page(items);
    },
  },
  {
    method: 'GET',
    path: '/files/:id',
    kind: 'consumer',
    handle: (_identity, { id }) => ({ status: 200, body: fileFor(id ?? '') }),
  },
];

/** Matches a request path against a route's path, where a `:name` segment matches any one segment. */
function matchPath(template: string, actual: string): Params | null {
  const wanted = template.split('/');
  const got = actual.split('/');
  if (wanted.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (const [index, segment] of wanted.entries()) {
    const value = got[index] ?? '';
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
    else if (segment !== value) return null;
  }
  return params;
}

function findRoute(
  method: string,
  path: string,
): { route: PublicRoute | ConsumerRoute | AnonymousRoute; params: Params } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const params = matchPath(route.path, path);
    if (params !== null) return { route, params };
  }
  return null;
}

const readBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text === '' ? undefined : (JSON.parse(text) as unknown));
      } catch {
        resolve(undefined);
      }
    });
    request.on('error', () => resolve(undefined));
  });

export interface StandinOptions {
  port: number;
  log?: (line: string) => void;
}

export interface RunningStandin {
  /** The API base the apps are built against, `/v1` included. */
  apiUrl: string;
  close: () => Promise<void>;
}

/** Starts the stand-in. Fixtures are checked first, so a drifted fixture stops the server, not a screen. */
export async function startStandin({
  port,
  log = (line) => process.stdout.write(`${line}\n`),
}: StandinOptions): Promise<RunningStandin> {
  checkFixtures();
  const server: Server = createServer((request, response) => {
    handle(request, response, log).catch((error: unknown) => {
      log(`ERROR ${request.method ?? 'GET'} ${request.url ?? '/'} — ${String(error)}`);
      send(response, problem(500, 'The visual-check stand-in failed on this request'));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, 'localhost', () => resolve());
  });
  // Port 0 asks the OS for a free one, which is how the tests run without colliding with a live stand-in.
  const address = server.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  return {
    apiUrl: `http://localhost:${bound}/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  log: (line: string) => void,
): Promise<void> {
  // The apps call this from their own origin, with credentials, so echo that origin back rather than '*'.
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*');
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, idempotency-key, x-request-id',
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Vary', 'Origin');

  const method = request.method ?? 'GET';
  if (method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  const url = new URL(request.url ?? '/', 'http://localhost');
  const label = `${method} ${url.pathname}`;
  if (url.pathname.startsWith('/socket.io/')) {
    // Realtime is deliberately not served: a stand-in holds no live trade to push. The apps retry quietly.
    log(`NOT SERVED ${label} — realtime is outside the stand-in`);
    send(response, problem(404, 'Realtime is not served by the visual-check stand-in'));
    return;
  }
  if (!url.pathname.startsWith('/v1/')) {
    log(`UNMATCHED ${label} — outside the /v1 base the apps call`);
    send(response, problem(404, 'Not in the visual-check stand-in', label));
    return;
  }
  const path = url.pathname.slice('/v1'.length);
  const found = findRoute(method, path);
  if (found === null) {
    log(`UNMATCHED ${label} — no fixture; add a route in tools/visual-check/src/standin/server.ts`);
    send(response, problem(404, 'Not in the visual-check stand-in', label));
    return;
  }
  const { route, params } = found;

  if (route.kind === 'public') {
    const reply = route.handle(await readBody(request));
    log(`${label} ${reply.status}`);
    send(response, reply);
    return;
  }
  if (route.kind === 'anonymous') {
    const reply = route.handle(params);
    log(`${label} ${reply.status}`);
    send(response, reply);
    return;
  }

  const identity = readBearer(request.headers.authorization);
  if (identity === null) {
    log(`${label} 401 — no bearer token from the stand-in`);
    send(response, problem(401, 'Not signed in'));
    return;
  }
  if (identity.persona.scope !== 'CONSUMER') {
    log(`${label} 403 — ${identity.persona.id} holds a ${identity.persona.scope} session`);
    send(response, problem(403, 'Wrong scope for this route'));
    return;
  }
  const reply = route.handle(identity, params, url.searchParams);
  log(`${label} ${reply.status} (${identity.persona.id}/${identity.scenario})`);
  send(response, reply);
}

function send(response: ServerResponse, reply: Reply): void {
  response.writeHead(reply.status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
}
