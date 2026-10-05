// An in-process provider stand-in. Outbound HTTP is tested against this rather than a mocked fetch,
// so timeouts, aborts and retries exercise the real client.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface StubHit {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface StubServer {
  url: string;
  hits: StubHit[];
  close(): Promise<void>;
}

/** `handler` receives the 0-based hit number, so a test can fail twice and then succeed. */
export async function startStubServer(
  handler: (req: IncomingMessage, res: ServerResponse, hit: number) => void,
): Promise<StubServer> {
  const hits: StubHit[] = [];
  const sockets = new Set<Socket>();

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const hit = hits.length;
      hits.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      handler(req, res, hit);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // A handler that never responds leaves its socket open; destroy them or close() hangs.
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
