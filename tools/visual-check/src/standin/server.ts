// The canned platform API. It answers the routes the frontends call, from `fixtures.ts`, and nothing else:
// no database, no Redis, no backend process. A route it does not know answers 404 and is logged as
// UNMATCHED, which is how a ticket finds out what its screen needs next.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { checkFixtures } from './contracts.ts';
import { tradesFor, viewerFactsFor } from './fixtures.ts';
import { accessTokenFor, readBearer, readRefreshToken, refreshTokenFor, type Identity } from './identity.ts';

export const STANDIN_DEFAULT_PORT = 7913;

export interface Reply {
  status: number;
  body?: unknown;
}

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
  handle: (identity: Identity) => Reply;
};

const ACCESS_LIFETIME_MS = 15 * 60 * 1000;

const problem = (status: number, title: string, detail?: string): Reply => ({
  status,
  body: { type: 'about:blank', title, status, ...(detail === undefined ? {} : { detail }) },
});

const ROUTES: readonly (PublicRoute | ConsumerRoute)[] = [
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
    handle: (identity) => ({ status: 200, body: viewerFactsFor(identity.persona.id) }),
  },
  {
    method: 'GET',
    path: '/trades',
    kind: 'consumer',
    handle: (identity) => ({
      status: 200,
      // The real list is cursor-paged. A fixture fits on one page, so the cursor is always null.
      body: { items: tradesFor(identity.persona.id, identity.scenario), nextCursor: null },
    }),
  },
];

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
  const route = ROUTES.find((candidate) => candidate.method === method && candidate.path === path);
  if (route === undefined) {
    log(`UNMATCHED ${label} — no fixture; add a route in tools/visual-check/src/standin/server.ts`);
    send(response, problem(404, 'Not in the visual-check stand-in', label));
    return;
  }

  if (route.kind === 'public') {
    const reply = route.handle(await readBody(request));
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
  const reply = route.handle(identity);
  log(`${label} ${reply.status} (${identity.persona.id}/${identity.scenario})`);
  send(response, reply);
}

function send(response: ServerResponse, reply: Reply): void {
  response.writeHead(reply.status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
}
