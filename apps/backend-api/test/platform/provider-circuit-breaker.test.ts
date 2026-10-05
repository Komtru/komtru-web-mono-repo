import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createCircuitBreaker } from '../../src/platform/providers/circuit-breaker.js';
import { ProviderHttpError, ProviderUnavailableError } from '../../src/platform/providers/http.js';

const silent = pino({ level: 'silent' });

/** A clock the test moves by hand, so no test waits on a reset window. */
const clock = (start = 1_000_000) => {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
};

const unavailable = () => new ProviderUnavailableError('google', 'oauth.token', 'timeout');
const serverError = () => new ProviderHttpError('google', 'oauth.token', 500, {});
const clientError = () => new ProviderHttpError('google', 'oauth.token', 400, {});

const breaker = (overrides: Partial<Parameters<typeof createCircuitBreaker>[0]> = {}) =>
  createCircuitBreaker({ name: 'google', logger: silent, ...overrides });

describe('createCircuitBreaker', () => {
  it('stays closed and returns the call result while calls succeed', async () => {
    const cb = breaker();
    await expect(cb.run('oauth.token', () => Promise.resolve('tok'))).resolves.toBe('tok');
    expect(cb.state()).toBe('closed');
  });

  it('opens after failureThreshold consecutive failures and then rejects without calling', async () => {
    let calls = 0;
    const cb = breaker({ failureThreshold: 3 });
    const failing = () => {
      calls++;
      return Promise.reject(unavailable());
    };

    for (let i = 0; i < 3; i++) await expect(cb.run('oauth.token', failing)).rejects.toThrow();
    expect(cb.state()).toBe('open');

    const error = await cb.run('oauth.token', failing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).reason).toBe('circuit-open');
    expect(calls).toBe(3);
  });

  it('counts a 5xx as a failure', async () => {
    const cb = breaker({ failureThreshold: 2 });
    for (let i = 0; i < 2; i++) {
      await expect(cb.run('oauth.token', () => Promise.reject(serverError()))).rejects.toThrow();
    }
    expect(cb.state()).toBe('open');
  });

  it('does not count a 4xx: a rejected request is not the provider being down', async () => {
    const cb = breaker({ failureThreshold: 2 });
    for (let i = 0; i < 10; i++) {
      await expect(cb.run('oauth.token', () => Promise.reject(clientError()))).rejects.toThrow();
    }
    expect(cb.state()).toBe('closed');
  });

  it('does not count an error of our own making', async () => {
    const cb = breaker({ failureThreshold: 2 });
    for (let i = 0; i < 5; i++) {
      await expect(cb.run('oauth.token', () => Promise.reject(new TypeError('bug')))).rejects.toThrow(
        TypeError,
      );
    }
    expect(cb.state()).toBe('closed');
  });

  it('resets the failure count on a success before the threshold', async () => {
    const cb = breaker({ failureThreshold: 3 });
    for (let i = 0; i < 2; i++) {
      await expect(cb.run('oauth.token', () => Promise.reject(unavailable()))).rejects.toThrow();
    }
    await cb.run('oauth.token', () => Promise.resolve('tok'));
    for (let i = 0; i < 2; i++) {
      await expect(cb.run('oauth.token', () => Promise.reject(unavailable()))).rejects.toThrow();
    }
    expect(cb.state()).toBe('closed');
  });

  it('goes half-open after resetAfterMs and closes again when the trial succeeds', async () => {
    const time = clock();
    const cb = breaker({ failureThreshold: 1, resetAfterMs: 30_000, now: time.now });

    await expect(cb.run('oauth.token', () => Promise.reject(unavailable()))).rejects.toThrow();
    expect(cb.state()).toBe('open');

    time.advance(29_999);
    expect(cb.state()).toBe('open');
    time.advance(2);
    expect(cb.state()).toBe('half-open');

    await expect(cb.run('oauth.token', () => Promise.resolve('tok'))).resolves.toBe('tok');
    expect(cb.state()).toBe('closed');
  });

  it('reopens when the half-open trial fails, and the reset window restarts from that failure', async () => {
    const time = clock();
    const cb = breaker({ failureThreshold: 1, resetAfterMs: 30_000, now: time.now });

    await expect(cb.run('oauth.token', () => Promise.reject(unavailable()))).rejects.toThrow();
    time.advance(30_001);
    await expect(cb.run('oauth.token', () => Promise.reject(unavailable()))).rejects.toThrow();

    expect(cb.state()).toBe('open');
    time.advance(29_999);
    expect(cb.state()).toBe('open');
  });
});
