// The registry entry, and the one seam server.ts uses. Nothing here opens a socket or dials Redis:
// a disabled gateway must build nothing at all, and an enabled one must be constructible before
// the HTTP server exists — that is what lets server.ts contribute a single line.
import { afterEach, describe, expect, it } from 'vitest';
import {
  socketModuleOf,
  type AttachableServer,
  type SocketModule,
} from '../../../src/modules/socket/index.js';
import type { ModuleContext } from '../../../src/platform/module.js';
import { testModule, testModules } from '../../support/modules.js';
import { socketConfig, silentLogger } from './support.js';

const stubContext = (overrides: Record<string, string> = {}): ModuleContext =>
  ({ config: socketConfig(overrides), logger: silentLogger }) as ModuleContext;

const started: SocketModule[] = [];

const build = async (overrides: Record<string, string> = {}): Promise<SocketModule> => {
  const module = socketModuleOf(testModules(overrides));
  if (!module) throw new Error('no socket module in the registry');
  await module.start?.(stubContext(overrides));
  started.push(module);
  return module;
};

afterEach(async () => {
  while (started.length > 0) await started.pop()?.stop?.();
});

describe('the socket module', () => {
  it('is in the registry under the name socket', () => {
    expect(testModules().map((m) => m.name)).toContain('socket');
  });

  it('declares no routes, no queues and no seed: it is not an HTTP surface', () => {
    const module = testModule('socket');
    expect(module.routes).toBeUndefined();
    expect(module.queues).toBeUndefined();
    expect(module.seed).toBeUndefined();
    expect(module.schedules).toBeUndefined();
  });

  it('does not claim to resolve the actor — identity is the only module that may', () => {
    expect(testModule('socket').resolveActor).toBeUndefined();
  });

  it('exposes the gateway and an attach hook through socketModuleOf', () => {
    const found = socketModuleOf(testModules());
    expect(typeof found?.attach).toBe('function');
    expect(typeof found?.gateway.emitToUser).toBe('function');
    expect(typeof found?.gateway.registerRoomAuthorizer).toBe('function');
  });

  it('finds nothing in a registry with no socket module', () => {
    expect(socketModuleOf(testModules().filter((m) => m.name !== 'socket'))).toBeUndefined();
  });

  it('starts and stops without an attached server', async () => {
    const module = await build();
    await expect(module.stop?.()).resolves.toBeUndefined();
    started.pop();
  });

  it('is inert when SOCKET_ENABLED is false: no server, no Redis, no timer', async () => {
    const module = await build({ SOCKET_ENABLED: 'false' });
    expect(() => module.attach({} as AttachableServer)).not.toThrow();
    expect(module.gateway.connectionCount()).toBe(0);
    // The no-op gateway must still be safe to call: a module that emits does not need to know.
    expect(() => module.gateway.emitToUser('u1', 'x', {})).not.toThrow();
  });
});
