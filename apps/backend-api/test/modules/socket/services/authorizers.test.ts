import { describe, expect, it, vi } from 'vitest';
import { createAuthorizerRegistry } from '../../../../src/modules/socket/services/authorizers.js';
import { testPrincipal } from '../../../support/actors.js';
import { silentLogger } from '../support.js';

const registry = () => createAuthorizerRegistry(silentLogger);
const input = {
  userId: 'u1',
  scope: 'CONSUMER' as const,
  principal: testPrincipal('u1'),
  prefix: 'trade',
  id: 'abc',
};

describe('the room authorizer registry', () => {
  it('denies a prefix nobody registered', async () => {
    await expect(registry().authorize(input)).resolves.toBe(false);
  });

  it('calls the registered authorizer and honours its answer', async () => {
    const r = registry();
    const authorizer = vi.fn().mockResolvedValue(true);
    r.register('trade', authorizer);
    await expect(r.authorize(input)).resolves.toBe(true);
    expect(authorizer).toHaveBeenCalledWith(input);
  });

  it('honours a synchronous denial', async () => {
    const r = registry();
    r.register('trade', () => false);
    await expect(r.authorize(input)).resolves.toBe(false);
  });

  it('denies when the authorizer throws, and does not rethrow', async () => {
    const r = registry();
    r.register('trade', () => {
      throw new Error('boom');
    });
    await expect(r.authorize(input)).resolves.toBe(false);
  });

  it('denies when the authorizer rejects', async () => {
    const r = registry();
    r.register('trade', () => Promise.reject(new Error('db down')));
    await expect(r.authorize(input)).resolves.toBe(false);
  });

  it('refuses a second authorizer for the same prefix', () => {
    const r = registry();
    r.register('trade', () => true);
    expect(() => r.register('trade', () => true)).toThrow(/already/);
  });

  it('refuses to register a reserved prefix', () => {
    expect(() => registry().register('user', () => true)).toThrow(/reserved/);
  });

  it('keeps registrations per instance, so two gateways cannot see each other', async () => {
    const a = registry();
    a.register('trade', () => true);
    await expect(registry().authorize(input)).resolves.toBe(false);
  });
});
