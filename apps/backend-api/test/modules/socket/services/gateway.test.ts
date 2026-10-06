import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createAuthorizerRegistry } from '../../../../src/modules/socket/services/authorizers.js';
import { createConnectionTable } from '../../../../src/modules/socket/services/connections.js';
import {
  createGateway,
  type Broadcaster,
  type SocketGateway,
} from '../../../../src/modules/socket/services/gateway.js';
import { silentLogger } from '../support.js';

type Room = ReturnType<Broadcaster['to']>;

let room: { emit: Mock<Room['emit']>; disconnectSockets: Mock<Room['disconnectSockets']> };
let io: { to: Mock<Broadcaster['to']> };
let gateway: SocketGateway;

beforeEach(() => {
  room = { emit: vi.fn(), disconnectSockets: vi.fn() };
  io = { to: vi.fn(() => room) };
  gateway = createGateway({
    io,
    authorizers: createAuthorizerRegistry(silentLogger),
    connections: createConnectionTable(),
    logger: silentLogger,
  });
});

describe('the socket gateway', () => {
  it('emits to the personal room', () => {
    gateway.emitToUser('u1', 'notification', { a: 1 });
    expect(io.to).toHaveBeenCalledWith('user:u1');
    expect(room.emit).toHaveBeenCalledWith('notification', { a: 1 });
  });

  it('emits to a scope room when asked, so a staff push never reaches the consumer app', () => {
    gateway.emitToUser('u1', 'x', {}, { scope: 'STAFF' });
    expect(io.to).toHaveBeenCalledWith('staff:u1');
  });

  it('emits to a feature room', () => {
    gateway.emitToRoom('trade', 't1', 'trade.updated', { id: 't1' });
    expect(io.to).toHaveBeenCalledWith('trade:t1');
    expect(room.emit).toHaveBeenCalledWith('trade.updated', { id: 't1' });
  });

  it('refuses to emit to a malformed feature room rather than inventing a name', () => {
    expect(() => gateway.emitToRoom('trade', 'a:b', 'x', {})).toThrow();
    expect(io.to).not.toHaveBeenCalled();
  });

  it('disconnects every socket in the personal room, closing the underlying connection', () => {
    gateway.disconnectUser('u1', 'suspended');
    expect(io.to).toHaveBeenCalledWith('user:u1');
    expect(room.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('exposes the authorizer registration other modules call at start', () => {
    gateway.registerRoomAuthorizer('trade', () => true);
    expect(() => gateway.registerRoomAuthorizer('trade', () => true)).toThrow(/already/);
  });

  it('counts only this instance’s connections', () => {
    expect(gateway.connectionCount()).toBe(0);
  });
});
