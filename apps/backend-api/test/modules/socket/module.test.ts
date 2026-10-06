// The registry entry, and the two seams server.ts uses (`attach`, `socketDrain`).
//
// Building the module opens the adapter's two Redis connections, so the registry is built once per
// case and always stopped: a file that calls `testModules()` per assertion leaves a dozen ioredis
// clients reconnecting for the rest of the run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adapterRedis from '../../../src/modules/socket/infrastructure/redis.js';
import {
  socketDrain,
  socketModuleOf,
  type AttachableServer,
  type SocketModule,
} from '../../../src/modules/socket/index.js';
import type { KomtruModule, ModuleContext } from '../../../src/platform/module.js';
import { testModules } from '../../support/modules.js';
import { socketConfig, silentLogger } from './support.js';

const stubContext = (overrides: Record<string, string> = {}): ModuleContext =>
  ({ config: socketConfig(overrides), logger: silentLogger }) as ModuleContext;

const built: KomtruModule[] = [];

/** One registry per case, remembered so `afterEach` can stop it. */
const registry = (overrides: Record<string, string> = {}): KomtruModule[] => {
  const modules = testModules(overrides);
  built.push(...modules);
  return modules;
};

const socket = (overrides: Record<string, string> = {}): SocketModule => {
  const found = socketModuleOf(registry(overrides));
  if (!found) throw new Error('no socket module in the registry');
  return found;
};

afterEach(async () => {
  while (built.length > 0) await built.pop()?.stop?.();
  vi.restoreAllMocks();
});

describe('the socket module', () => {
  it('is in the registry under the name socket', () => {
    expect(registry().map((m) => m.name)).toContain('socket');
  });

  it('declares no routes, no queues and no seed: it is not an HTTP surface', () => {
    const module = socket();
    expect(module.routes).toBeUndefined();
    expect(module.queues).toBeUndefined();
    expect(module.seed).toBeUndefined();
    expect(module.schedules).toBeUndefined();
  });

  it('does not claim to resolve the actor — identity is the only module that may', () => {
    expect(socket().resolveActor).toBeUndefined();
  });

  it('exposes the gateway, attach and drain through socketModuleOf', () => {
    const found = socket();
    expect(typeof found.attach).toBe('function');
    expect(typeof found.drain).toBe('function');
    expect(typeof found.gateway.emitToUser).toBe('function');
    expect(typeof found.gateway.registerRoomAuthorizer).toBe('function');
  });

  it('finds nothing in a registry with no socket module', () => {
    expect(socketModuleOf(registry().filter((m) => m.name !== 'socket'))).toBeUndefined();
  });

  it('contributes one shutdown closer, which server.ts runs before the HTTP drain', () => {
    expect(socketDrain(registry()).map((c) => c.name)).toEqual(['socket:drain']);
    expect(socketDrain([])).toEqual([]);
  });

  it('starts and stops without an attached server', async () => {
    const module = socket();
    await module.start?.(stubContext());
    await expect(module.stop?.()).resolves.toBeUndefined();
    built.length = 0;
  });

  it('drains without an attached server', () => {
    expect(() => socket().drain()).not.toThrow();
  });
});

describe('when SOCKET_ENABLED is false', () => {
  it('opens no Redis connection at all', () => {
    const open = vi.spyOn(adapterRedis, 'createAdapterConnections');
    socket({ SOCKET_ENABLED: 'false' });
    expect(open).not.toHaveBeenCalled();
  });

  it('opens exactly one pair of adapter connections when it is enabled', () => {
    const open = vi.spyOn(adapterRedis, 'createAdapterConnections');
    socket();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('arms no re-validation timer', async () => {
    const arm = vi.spyOn(globalThis, 'setInterval');
    const module = socket({ SOCKET_ENABLED: 'false' });
    await module.start?.(stubContext({ SOCKET_ENABLED: 'false' }));
    expect(arm).not.toHaveBeenCalled();
  });

  it('arms one when it is enabled', async () => {
    const arm = vi.spyOn(globalThis, 'setInterval');
    const module = socket();
    await module.start?.(stubContext());
    expect(arm).toHaveBeenCalledTimes(1);
  });

  it('attaches and drains as no-ops, and still refuses a reserved room prefix', () => {
    const module = socket({ SOCKET_ENABLED: 'false' });
    expect(() => module.attach({} as AttachableServer)).not.toThrow();
    expect(() => module.drain()).not.toThrow();
    expect(() => module.gateway.emitToUser('u1', 'x', {})).not.toThrow();
    // A module claiming a personal-room prefix is a boot failure whether or not sockets are served.
    expect(() => module.gateway.registerRoomAuthorizer('user', () => true)).toThrow(/reserved/);
  });
});
