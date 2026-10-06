import { describe, expect, it } from 'vitest';
import { roomRequestSchema, tokenRequestSchema } from '../../../../src/modules/socket/domain/protocol.js';

describe('the client protocol', () => {
  it('parses a well-formed join request', () => {
    expect(roomRequestSchema.safeParse({ prefix: 'trade', id: 'abc' }).success).toBe(true);
  });

  it.each([{}, { prefix: 'trade' }, { prefix: 1, id: 'a' }, null, 'trade:abc', []])(
    'rejects the malformed join request %j',
    (payload) => {
      expect(roomRequestSchema.safeParse(payload).success).toBe(false);
    },
  );

  it('parses a token request', () => {
    expect(tokenRequestSchema.safeParse({ token: 'abc' }).success).toBe(true);
  });

  it.each([{ token: '' }, {}, { token: 123 }, undefined])(
    'rejects the malformed token request %j',
    (payload) => {
      expect(tokenRequestSchema.safeParse(payload).success).toBe(false);
    },
  );
});
