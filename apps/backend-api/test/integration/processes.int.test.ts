import { randomBytes } from 'node:crypto';
// Boots the real API and worker processes' wiring against the local Docker stack.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeAll, describe, expect, it } from 'vitest';
import { RuntimeRoleError } from '../../src/db/index.js';
import { z } from 'zod';
import { defineRoute } from '../../src/platform/http/route.js';
import { defineModule } from '../../src/platform/module.js';
import { startApi } from '../../src/server.js';
import { startWorker } from '../../src/worker-process.js';
import { directUrl, infraEnabled, pooledUrl, testRedisEnv, testRedisUrl } from '../support/db-urls.js';
import { useTestDatabase, workerDatabase } from '../support/db.js';

// The real registry includes identity, which refuses to boot without a signing key — which is the
// point of that refusal, so the test supplies a throwaway one rather than skipping the check.
const base = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: '0',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
  IDENTITY_SIGNING_KEY: randomBytes(32).toString('hex'),
  IDENTITY_SIGNING_KEY_ID: 'test-key',
};

describe.runIf(infraEnabled)('process wiring', () => {
  useTestDatabase();
  // Resolved lazily: the worker's database name is only known inside the test run.
  let env: Record<string, string>;
  beforeAll(() => {
    env = { ...base, POSTGRES_URL: pooledUrl(workerDatabase()) };
  });

  it('starts the API, serves readiness, and shuts down cleanly', async () => {
    const api = await startApi(env);
    const { port } = api.server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
    expect(await api.stop()).toEqual({ clean: true, failed: [], timedOut: false });
    expect(api.server.listening).toBe(false);
  });

  it('starts the worker and shuts it down cleanly', async () => {
    const worker = await startWorker(env);
    expect(await worker.stop()).toEqual({ clean: true, failed: [], timedOut: false });
  });

  it('drains an in-flight keep-alive request, then runs every closer', async () => {
    const stopped: string[] = [];
    const slow = defineModule({
      name: 'slow',
      routes: [
        defineRoute({
          method: 'get',
          path: '/slow',
          scope: 'PUBLIC',
          summary: 'A request that is still running when shutdown starts',
          schema: { response: z.object({ done: z.boolean() }) },
          handler: async () => {
            await new Promise((r) => setTimeout(r, 300));
            return { done: true };
          },
        }),
      ],
      stop: () => {
        stopped.push('slow');
        return Promise.resolve();
      },
    });
    const api = await startApi(env, () => [slow]);
    const { port } = api.server.address() as AddressInfo;
    const agent = new http.Agent({ keepAlive: true });

    const response = new Promise<{ status: number; connection: string | undefined }>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/v1/slow', agent }, (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0, connection: res.headers.connection }));
        })
        .on('error', reject);
    });
    await new Promise((r) => setTimeout(r, 50)); // the request is now in flight

    const started = Date.now();
    const result = await api.stop();
    expect(await response).toEqual({ status: 200, connection: 'close' });
    expect(result).toEqual({ clean: true, failed: [], timedOut: false });
    expect(stopped).toEqual(['slow']);
    expect(Date.now() - started).toBeLessThan(3000);
    agent.destroy();
  });

  it('rejects when the port is already in use', async () => {
    const first = await startApi(env, () => []);
    const { port } = first.server.address() as AddressInfo;
    try {
      await expect(startApi({ ...env, PORT: String(port) }, () => [])).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.stop();
    }
  });

  it('stops every module even when one fails to stop', async () => {
    const stopped: string[] = [];
    const ok = (name: string) => defineModule({ name, stop: () => (stopped.push(name), Promise.resolve()) });
    const broken = defineModule({ name: 'broken', stop: () => Promise.reject(new Error('boom')) });
    const api = await startApi(env, () => [ok('first'), broken, ok('last')]);
    const result = await api.stop();
    expect(stopped).toEqual(['last', 'first']);
    expect(result).toEqual({ clean: false, failed: ['module:broken'], timedOut: false });
  });

  it.each([
    ['API', () => startApi({ ...base, POSTGRES_URL: directUrl(workerDatabase()) }, () => [])],
    ['worker', () => startWorker({ ...base, POSTGRES_URL: directUrl(workerDatabase()) }, () => [])],
  ])('refuses to start the %s as the schema owner', async (_name, start) => {
    await expect(start()).rejects.toBeInstanceOf(RuntimeRoleError);
  });

  it('refuses to start without required configuration, naming what is missing', async () => {
    await expect(startApi({ NODE_ENV: 'test' })).rejects.toThrow(/POSTGRES_URL.*REDIS_URL/);
  });
});
