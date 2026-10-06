// The ticket's acceptance criterion "sessions are re-validated when the user's session epoch bumps;
// revoked sockets disconnect", in the one place the decision is actually made.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionTable,
  type Connection,
  type ConnectionTable,
} from '../../../../src/modules/socket/services/connections.js';
import {
  revalidateConnections,
  type RevalidateDeps,
} from '../../../../src/modules/socket/services/revalidate.js';
import { rejectedActor, type Actor } from '../../../../src/platform/http/principal.js';
import { testActor, testPrincipal } from '../../../support/actors.js';
import { silentLogger } from '../support.js';

const NOW = 1_700_000_000_000;
/** Ten-minute token plus a one-minute grace, as the default configuration composes it. */
const MAX_AGE_MS = 660_000;

let table: ConnectionTable;

const connection = (overrides: Partial<Connection> = {}): Connection => {
  const userId = overrides.userId ?? 'u1';
  const c: Connection = {
    id: 'socket-1',
    userId,
    sessionId: 'session-1',
    token: 'token-1',
    verifiedAt: NOW,
    principal: testPrincipal(userId),
    emit: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  };
  table.add(c);
  return c;
};

const deps = (authenticate: (token: string) => Promise<Actor>): RevalidateDeps => ({
  authenticate,
  connections: table,
  logger: silentLogger,
  maxCredentialAgeMs: MAX_AGE_MS,
  now: () => NOW,
});

beforeEach(() => {
  table = createConnectionTable();
});

describe('re-validating live sockets', () => {
  it('keeps a socket whose credential still resolves, and refreshes its principal', async () => {
    const c = connection({ principal: testPrincipal('u1', { sessionsEpoch: 1 }), verifiedAt: NOW - 5_000 });
    const result = await revalidateConnections(
      deps(() => Promise.resolve(testActor('u1', { sessionsEpoch: 2, roles: ['support'] }))),
    );
    expect(result).toMatchObject({ checked: 1, kept: 1, disconnected: 0, refreshRequested: 0 });
    expect(c.disconnect).not.toHaveBeenCalled();
    expect(c.verifiedAt).toBe(NOW);
    expect(table.get('socket-1')?.principal.roles).toEqual(['support']);
  });

  it('disconnects a socket whose user bumped their session epoch', async () => {
    const c = connection();
    const result = await revalidateConnections(deps(() => Promise.resolve(rejectedActor('EPOCH_STALE'))));
    expect(c.emit).toHaveBeenCalledWith('auth:revoked', { code: 'EPOCH_STALE' });
    expect(c.disconnect).toHaveBeenCalled();
    expect(result).toMatchObject({ disconnected: 1, kept: 0 });
    expect(table.size()).toBe(0);
  });

  it.each(['SESSION_REVOKED', 'SESSION_EXPIRED', 'USER_INACTIVE', 'TOKEN_INVALID'] as const)(
    'disconnects on %s',
    async (failure) => {
      const c = connection();
      await revalidateConnections(deps(() => Promise.resolve(rejectedActor(failure))));
      expect(c.emit).toHaveBeenCalledWith('auth:revoked', { code: failure });
      expect(c.disconnect).toHaveBeenCalled();
    },
  );

  it('asks for a fresh token rather than dropping a socket whose token merely expired', async () => {
    const c = connection({ verifiedAt: NOW - 1_000 });
    const result = await revalidateConnections(deps(() => Promise.resolve(rejectedActor('TOKEN_EXPIRED'))));
    expect(c.emit).toHaveBeenCalledWith('auth:refresh', { code: 'TOKEN_EXPIRED' });
    expect(c.disconnect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ refreshRequested: 1, disconnected: 0 });
  });

  it('drops a socket that has not re-presented a credential within the grace window', async () => {
    const c = connection({ verifiedAt: NOW - MAX_AGE_MS - 1 });
    await revalidateConnections(deps(() => Promise.resolve(rejectedActor('TOKEN_EXPIRED'))));
    expect(c.emit).toHaveBeenCalledWith('auth:revoked', { code: 'TOKEN_EXPIRED' });
    expect(c.disconnect).toHaveBeenCalled();
  });

  it('authenticates each distinct credential once, however many sockets hold it', async () => {
    connection({ id: 'a', token: 'shared' });
    connection({ id: 'b', token: 'shared' });
    connection({ id: 'c', token: 'other' });
    const authenticate = vi.fn().mockResolvedValue(testActor('u1'));
    const result = await revalidateConnections(deps(authenticate));
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(result.checked).toBe(3);
  });

  it('applies one credential verdict to every socket holding it', async () => {
    const a = connection({ id: 'a', token: 'shared' });
    const b = connection({ id: 'b', token: 'shared' });
    await revalidateConnections(deps(() => Promise.resolve(rejectedActor('EPOCH_STALE'))));
    expect(a.disconnect).toHaveBeenCalled();
    expect(b.disconnect).toHaveBeenCalled();
  });

  it('disconnects a socket whose credential now resolves to a different user', async () => {
    const c = connection({ userId: 'u1' });
    await revalidateConnections(deps(() => Promise.resolve(testActor('u2'))));
    expect(c.emit).toHaveBeenCalledWith('auth:revoked', { code: 'TOKEN_INVALID' });
    expect(c.disconnect).toHaveBeenCalled();
  });

  it('keeps sweeping the rest when one credential check rejects, and keeps that socket', async () => {
    const bad = connection({ id: 'a', token: 'bad' });
    const good = connection({ id: 'b', token: 'good' });
    const result = await revalidateConnections(
      deps((token) =>
        token === 'bad' ? Promise.reject(new Error('redis down')) : Promise.resolve(testActor('u1')),
      ),
    );
    expect(bad.disconnect).not.toHaveBeenCalled();
    expect(good.disconnect).not.toHaveBeenCalled();
    expect(result.checked).toBe(2);
  });

  it('does nothing, and calls nothing, when no sockets are connected', async () => {
    const authenticate = vi.fn();
    const result = await revalidateConnections(deps(authenticate));
    expect(authenticate).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, kept: 0, disconnected: 0, refreshRequested: 0 });
  });
});
