// Shared setup for T-027's integration tests: two real API processes against one Redis and one
// database, and a real socket.io-client to connect to them. Imported only from *.int.test.ts, so
// nothing here runs unless KOMTRU_INFRA_TESTS=1.
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createModules } from '../../../src/modules/index.js';
import { socketModuleOf, type SocketGateway } from '../../../src/modules/socket/index.js';
import { startApi, type RunningApi } from '../../../src/server.js';
import { pooledUrl, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { workerDatabase } from '../../support/db.js';
import { identityProcessEnv } from '../../support/identity-env.js';

export interface ApiInstance {
  api: RunningApi;
  gateway: SocketGateway;
  url: string;
}

/**
 * The signing key is shared across instances on purpose: two API processes behind one load balancer
 * verify the same tokens, and a per-instance key would make this suite pass for the wrong reason.
 */
export const sharedEnv = (overrides: Record<string, string> = {}): Record<string, string> => ({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: '0',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
  POSTGRES_URL: pooledUrl(workerDatabase()),
  ...identityProcessEnv(),
  ...overrides,
});

/** Boots an API process and hands back its gateway, caught as the registry is built. */
export async function startInstance(env: Record<string, string>): Promise<ApiInstance> {
  let gateway: SocketGateway | undefined;
  const api = await startApi(env, (deps) => {
    const modules = createModules(deps);
    gateway = socketModuleOf(modules)?.gateway;
    return modules;
  });
  if (!gateway) throw new Error('startInstance(): the registry built no socket gateway');
  const { port } = api.server.address() as AddressInfo;
  return { api, gateway, url: `http://127.0.0.1:${String(port)}` };
}

/** A Socket.IO client, with reconnection off so a disconnect under test stays a disconnect. */
export const client = (instance: ApiInstance, auth: Record<string, unknown>): Socket =>
  connect(instance.url, { auth, transports: ['websocket'], reconnection: false });

export const connected = (socket: Socket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });

/** Resolves with the rejection's message, which the gateway sets to the `AuthFailure` code. */
export const rejection = (socket: Socket): Promise<string> =>
  new Promise((resolve, reject) => {
    socket.once('connect_error', (error: Error) => resolve(error.message));
    socket.once('connect', () => reject(new Error('the handshake was admitted')));
  });

export const nextEvent = <T>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${event}" in ${String(timeoutMs)}ms`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
