import { describe, expect, it } from 'vitest';
import {
  assertRegisterablePrefix,
  featureRoom,
  isJoinableRoom,
  personalRoom,
  roomsForPrincipal,
} from '../../../../src/modules/socket/domain/rooms.js';

describe('room names', () => {
  it('puts every user in one personal room regardless of scope, plus a scope room', () => {
    expect(roomsForPrincipal({ userId: 'u1', scope: 'CONSUMER' })).toEqual(['user:u1', 'consumer:u1']);
    expect(roomsForPrincipal({ userId: 'u1', scope: 'STAFF' })).toEqual(['user:u1', 'staff:u1']);
    expect(roomsForPrincipal({ userId: 'u1', scope: 'LOGISTICS' })).toEqual(['user:u1', 'logistics:u1']);
  });

  it('names the personal room after the user and nothing else', () => {
    expect(personalRoom('u1')).toBe('user:u1');
  });

  it('names a feature room from its prefix and id', () => {
    expect(featureRoom('trade', 't1')).toBe('trade:t1');
  });

  it('refuses to build a feature room name a client could not legally join', () => {
    expect(() => featureRoom('trade', 'a:b')).toThrow();
    expect(() => featureRoom('user', 'victim')).toThrow();
  });

  it.each(['user', 'consumer', 'staff', 'logistics'])(
    'refuses to register the reserved prefix %s',
    (prefix) => {
      expect(() => assertRegisterablePrefix(prefix)).toThrow(/reserved/);
    },
  );

  it.each(['Trade', 'trade:x', '', '1trade', 'a'.repeat(33), 'trade_room'])(
    'refuses the malformed prefix %s',
    (prefix) => {
      expect(() => assertRegisterablePrefix(prefix)).toThrow();
    },
  );

  it('accepts a well-formed feature prefix', () => {
    expect(() => assertRegisterablePrefix('dispute-chat')).not.toThrow();
  });

  it.each(['x:user:victim', 'a'.repeat(65), '', 'has space', '../x'])('refuses the join id %s', (id) => {
    expect(isJoinableRoom('trade', id)).toBe(false);
  });

  it('accepts a uuid room id', () => {
    expect(isJoinableRoom('trade', '7f1a9e2c-0b44-4c2e-9a3d-8e5b1c2d3f40')).toBe(true);
  });

  it('refuses a join whose prefix is reserved, so no client can enter a personal room', () => {
    expect(isJoinableRoom('user', 'someone-else')).toBe(false);
    expect(isJoinableRoom('staff', 'someone-else')).toBe(false);
  });
});
