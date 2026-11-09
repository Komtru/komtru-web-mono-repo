// The executable contract for `AvatarPorts.fetchImage` (T-041). T-034 wires the real implementation and
// must run this suite against it (see docs/tickets/03-identity.md, T-034).
//
//   1. refuses a private/loopback/link-local address, judged on the address actually connected to;
//   2. follows no redirects;
//   3. stops and rejects once more than the cap has arrived, whatever Content-Length says or omits;
//   4. times out as a whole, including a body that trickles.
//
// The stub server is on 127.0.0.1 over http, so an implementation is built twice: with
// `allowLoopbackHttp: true` (a TEST-ONLY switch that lets the stub through, to exercise cases 2-4) and
// with `false` (production behaviour, which must refuse it: case 1). The switch must exist in the
// implementation only as a constructor option no production code path sets.
import { describe, expect, it } from 'vitest';
import { PROVIDER_IMAGE_MAX_BYTES } from '../../src/modules/identity/domain/avatar.js';
import { startStubServer, type StubServer } from './stub-server.js';

export interface FetchImageOptions {
  allowLoopbackHttp: boolean;
  timeoutMs: number;
}
export type FetchImage = (url: URL) => Promise<{ bytes: Uint8Array }>;

export function describeFetchImageContract(
  name: string,
  make: (options: FetchImageOptions) => FetchImage,
): void {
  describe(`fetchImage contract: ${name}`, () => {
    const withServer = async (
      handler: Parameters<typeof startStubServer>[0],
      run: (server: StubServer) => Promise<void>,
    ) => {
      const server = await startStubServer(handler);
      try {
        await run(server);
      } finally {
        await server.close();
      }
    };

    it('returns the bytes of a plain image', async () => {
      await withServer(
        (_req, res) => {
          res.writeHead(200, { 'content-type': 'image/png' });
          res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        },
        async (server) => {
          const image = await make({ allowLoopbackHttp: true, timeoutMs: 2000 })(
            new URL(`${server.url}/a.png`),
          );
          expect([...image.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
        },
      );
    });

    it('refuses a private address without sending a request', async () => {
      await withServer(
        (_req, res) => res.end('x'),
        async (server) => {
          await expect(
            make({ allowLoopbackHttp: false, timeoutMs: 2000 })(new URL(`${server.url}/a.png`)),
          ).rejects.toBeDefined();
          expect(server.hits).toHaveLength(0);
        },
      );
    });

    it('does not follow a redirect', async () => {
      await withServer(
        (_req, res, hit) => {
          if (hit === 0) {
            res.writeHead(302, { location: '/elsewhere.png' });
            res.end();
          } else {
            res.end('should never be fetched');
          }
        },
        async (server) => {
          await expect(
            make({ allowLoopbackHttp: true, timeoutMs: 2000 })(new URL(`${server.url}/a.png`)),
          ).rejects.toBeDefined();
          expect(server.hits).toHaveLength(1);
        },
      );
    });

    it('rejects a body over the cap that never declares its length, without reading all of it', async () => {
      let sent = 0;
      await withServer(
        (_req, res) => {
          res.writeHead(200, { 'content-type': 'image/png' });
          const chunk = Buffer.alloc(256 * 1024, 1);
          const pump = () => {
            while (sent < PROVIDER_IMAGE_MAX_BYTES * 20) {
              sent += chunk.length;
              if (!res.write(chunk)) return void res.once('drain', pump);
            }
            res.end();
          };
          res.on('close', () => undefined);
          pump();
        },
        async (server) => {
          await expect(
            make({ allowLoopbackHttp: true, timeoutMs: 5000 })(new URL(`${server.url}/big.png`)),
          ).rejects.toBeDefined();
          // It hung up near the cap; the server was nowhere near done with 20x.
          expect(sent).toBeLessThan(PROVIDER_IMAGE_MAX_BYTES * 10);
        },
      );
    });

    it('times out on a body that trickles forever', async () => {
      await withServer(
        (_req, res) => {
          res.writeHead(200, { 'content-type': 'image/png' });
          const timer = setInterval(() => res.write(Buffer.from([1])), 50);
          res.on('close', () => clearInterval(timer));
        },
        async (server) => {
          const started = Date.now();
          await expect(
            make({ allowLoopbackHttp: true, timeoutMs: 300 })(new URL(`${server.url}/slow.png`)),
          ).rejects.toBeDefined();
          expect(Date.now() - started).toBeLessThan(3000);
        },
      );
    });
  });
}
