// Boots the real API and worker processes' wiring against the local Docker stack.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { startApi } from '../../src/server.js';
import { startWorker } from '../../src/worker-process.js';

const enabled = process.env.KOMTRU_INFRA_TESTS === '1';
const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: '0',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: 'redis://localhost:56379',
};

describe.runIf(enabled)('process wiring', () => {
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

  it('refuses to start without required configuration, naming what is missing', async () => {
    await expect(startApi({ NODE_ENV: 'test' })).rejects.toThrow(/POSTGRES_URL.*REDIS_URL/);
  });
});
