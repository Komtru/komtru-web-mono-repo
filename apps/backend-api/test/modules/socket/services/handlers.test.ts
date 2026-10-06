import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createAuthorizerRegistry } from '../../../../src/modules/socket/services/authorizers.js';
import { createConnectionTable } from '../../../../src/modules/socket/services/connections.js';
import {
  authenticateHandshake,
  credentialFrom,
  type GatewaySocket,
  type HandlerDeps,
} from '../../../../src/modules/socket/services/handlers.js';
import { rejectedActor, type Actor } from '../../../../src/platform/http/principal.js';
import { testActor } from '../../../support/actors.js';
import { silentLogger } from '../support.js';

type Listener = (...args: never[]) => void;

interface FakeSocket extends GatewaySocket {
  listeners: Map<string, Listener>;
  join: Mock<GatewaySocket['join']>;
  leave: Mock<GatewaySocket['leave']>;
  emit: Mock<GatewaySocket['emit']>;
  disconnect: Mock<GatewaySocket['disconnect']>;
}

const fakeSocket = (auth: Record<string, unknown> = { token: 'tok' }): FakeSocket => {
  const listeners = new Map<string, Listener>();
  return {
    id: 'socket-1',
    handshake: { auth, headers: {} },
    listeners,
    join: vi.fn(),
    leave: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event: string, listener: Listener) => void listeners.set(event, listener)),
    data: {},
  };
};

let deps: HandlerDeps;
let socket: FakeSocket;

const admit = (actor: Actor = testActor('u1')) => {
  deps.authenticate = () => Promise.resolve(actor);
  return authenticateHandshake(deps, socket);
};

/** Fires a client event through the listener `attachSocket` registered, returning its ack. */
const fire = async (event: string, payload: unknown): Promise<unknown> => {
  const listener = socket.listeners.get(event);
  if (!listener) throw new Error(`no listener for ${event}`);
  return new Promise((resolve) => {
    (listener as (p: unknown, ack: (r: unknown) => void) => void)(payload, resolve);
  });
};

beforeEach(() => {
  socket = fakeSocket();
  deps = {
    authenticate: () => Promise.resolve(testActor('u1')),
    authorizers: createAuthorizerRegistry(silentLogger),
    connections: createConnectionTable(),
    logger: silentLogger,
  };
});

describe('reading the credential off a handshake', () => {
  it('reads handshake.auth.token', () => {
    expect(credentialFrom({ auth: { token: 'abc' }, headers: {} })).toBe('abc');
  });

  it('falls back to the Authorization header, for a client that cannot set auth', () => {
    expect(credentialFrom({ auth: {}, headers: { authorization: 'Bearer abc' } })).toBe('abc');
  });

  it('reads nothing when there is nothing to read', () => {
    expect(credentialFrom({ auth: {}, headers: {} })).toBeUndefined();
    expect(credentialFrom({ auth: { token: '' }, headers: {} })).toBeUndefined();
    expect(credentialFrom({ auth: { token: 42 }, headers: {} })).toBeUndefined();
    expect(credentialFrom({ auth: {}, headers: { authorization: 'Basic abc' } })).toBeUndefined();
  });
});

describe('the handshake', () => {
  it('rejects a connection with no credential', async () => {
    socket = fakeSocket({});
    const error = await authenticateHandshake(deps, socket);
    expect(error?.message).toBe('TOKEN_MISSING');
    expect(deps.connections.size()).toBe(0);
  });

  it('rejects a credential identity refuses, naming the reason the client can act on', async () => {
    const error = await admit(rejectedActor('SESSION_REVOKED'));
    expect(error?.message).toBe('SESSION_REVOKED');
    expect((error as Error & { data?: unknown }).data).toEqual({ code: 'SESSION_REVOKED' });
  });

  it('admits a valid credential, joins the personal rooms and records the connection', async () => {
    expect(await admit(testActor('u1', { scope: 'CONSUMER' }))).toBeUndefined();
    expect(socket.join).toHaveBeenCalledWith('user:u1');
    expect(socket.join).toHaveBeenCalledWith('consumer:u1');
    expect(deps.connections.get('socket-1')).toMatchObject({ userId: 'u1', token: 'tok' });
  });

  it('puts a staff session in the same personal room plus its own scope room', async () => {
    await admit(testActor('u1', { scope: 'STAFF' }));
    expect(socket.join).toHaveBeenCalledWith('user:u1');
    expect(socket.join).toHaveBeenCalledWith('staff:u1');
  });

  it('never trusts a client-supplied user id', async () => {
    socket = fakeSocket({ token: 'tok', userId: 'victim' });
    await admit(testActor('u1'));
    expect(socket.join).not.toHaveBeenCalledWith('user:victim');
  });
});

describe('room membership', () => {
  beforeEach(async () => {
    await admit();
  });

  it('joins a feature room when its authorizer allows it', async () => {
    deps.authorizers.register('trade', () => true);
    await expect(fire('room:join', { prefix: 'trade', id: 't1' })).resolves.toEqual({ joined: true });
    expect(socket.join).toHaveBeenCalledWith('trade:t1');
  });

  it('refuses a feature room its authorizer denies', async () => {
    deps.authorizers.register('trade', () => false);
    await expect(fire('room:join', { prefix: 'trade', id: 't1' })).resolves.toEqual({
      joined: false,
      reason: 'FORBIDDEN',
    });
    expect(socket.join).not.toHaveBeenCalledWith('trade:t1');
  });

  it('refuses a prefix nobody registered — there is no default-allow room type', async () => {
    await expect(fire('room:join', { prefix: 'trade', id: 't1' })).resolves.toEqual({
      joined: false,
      reason: 'FORBIDDEN',
    });
  });

  it('refuses a join that names a personal room', async () => {
    await expect(fire('room:join', { prefix: 'user', id: 'victim' })).resolves.toEqual({
      joined: false,
      reason: 'INVALID_ROOM',
    });
    expect(socket.join).not.toHaveBeenCalledWith('user:victim');
  });

  it('refuses a room id that tries to shape a name of its own', async () => {
    deps.authorizers.register('trade', () => true);
    await expect(fire('room:join', { prefix: 'trade', id: 'x:user:victim' })).resolves.toEqual({
      joined: false,
      reason: 'INVALID_ROOM',
    });
  });

  it('refuses a malformed join payload without throwing', async () => {
    await expect(fire('room:join', { prefix: 'trade' })).resolves.toEqual({
      joined: false,
      reason: 'INVALID_ROOM',
    });
    await expect(fire('room:join', null)).resolves.toEqual({ joined: false, reason: 'INVALID_ROOM' });
  });

  it('leaves a room on request', async () => {
    await fire('room:leave', { prefix: 'trade', id: 't1' });
    expect(socket.leave).toHaveBeenCalledWith('trade:t1');
  });

  it('ignores a leave for a room name it would never have joined', async () => {
    await fire('room:leave', { prefix: 'user', id: 'victim' });
    expect(socket.leave).not.toHaveBeenCalled();
  });
});

describe('re-presenting a credential', () => {
  beforeEach(async () => {
    await admit();
  });

  it('replaces the stored credential when the client presents a fresh token', async () => {
    await fire('auth:token', { token: 'fresh' });
    expect(deps.connections.get('socket-1')?.token).toBe('fresh');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects rather than re-point a socket at a different user', async () => {
    deps.authenticate = () => Promise.resolve(testActor('u2'));
    await fire('auth:token', { token: 'other-user' });
    expect(socket.emit).toHaveBeenCalledWith('auth:revoked', { code: 'TOKEN_INVALID' });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(deps.connections.size()).toBe(0);
  });

  it('disconnects when the fresh credential is itself refused', async () => {
    deps.authenticate = () => Promise.resolve(rejectedActor('EPOCH_STALE'));
    await fire('auth:token', { token: 'stale' });
    expect(socket.emit).toHaveBeenCalledWith('auth:revoked', { code: 'EPOCH_STALE' });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('keeps the old credential when the new payload is malformed', async () => {
    await fire('auth:token', { token: '' });
    expect(deps.connections.get('socket-1')?.token).toBe('tok');
  });

  it('removes the connection from the table on disconnect', () => {
    const onDisconnect = socket.listeners.get('disconnect');
    onDisconnect?.();
    expect(deps.connections.size()).toBe(0);
  });
});
