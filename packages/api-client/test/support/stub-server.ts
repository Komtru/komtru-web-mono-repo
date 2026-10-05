// A real HTTP server, not a fetch mock: transport behaviour (headers, bodies, timeouts, aborts) is
// only proved against something that actually speaks HTTP.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

export interface StubRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface StubReply {
  status?: number;
  headers?: Record<string, string>;
  /** A string is sent verbatim; anything else is JSON-encoded. `undefined` sends no body. */
  body?: unknown;
  delayMs?: number;
}

export interface StubServer {
  url: string;
  requests: StubRequest[];
  /** `callNumber` is 1-based, which is how a test says "401 the first time, 200 the second". */
  reply: (handler: (req: StubRequest, callNumber: number) => StubReply | Promise<StubReply>) => void;
  close: () => Promise<void>;
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

export async function startStubServer(): Promise<StubServer> {
  const requests: StubRequest[] = [];
  let handler: (req: StubRequest, callNumber: number) => StubReply | Promise<StubReply> = () => ({
    status: 200,
    body: {},
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const record: StubRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
        ) as Record<string, string>,
        body: await readBody(req),
      };
      requests.push(record);

      let reply: StubReply;
      try {
        reply = await handler(record, requests.length);
      } catch {
        res.writeHead(500).end();
        return;
      }
      if (reply.delayMs) await delay(reply.delayMs);
      if (res.destroyed) return;

      const status = reply.status ?? 200;
      const payload =
        reply.body === undefined
          ? undefined
          : typeof reply.body === 'string'
            ? reply.body
            : JSON.stringify(reply.body);
      const headers: Record<string, string> = { ...reply.headers };
      if (payload !== undefined && !('content-type' in headers) && !('Content-Type' in headers)) {
        headers['Content-Type'] =
          typeof reply.body === 'string'
            ? 'text/html'
            : status >= 400
              ? 'application/problem+json'
              : 'application/json';
      }
      res.writeHead(status, headers);
      res.end(payload);
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub server has no port');

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    reply: (next) => {
      handler = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
