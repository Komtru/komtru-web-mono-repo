// A consecutive-failure breaker for the one provider call that cannot be queued: the OAuth
// authorization-code exchange during social login (design §4.4, T-034). The user is mid-redirect, so a
// provider outage must fail the handshake in milliseconds rather than hold a request open per login
// attempt. Everything else reaches providers from a job, where the queue's backoff plays this role.
import type { Logger } from '../logger.js';
import { ProviderHttpError, ProviderUnavailableError } from './http.js';

export interface CircuitBreakerOptions {
  /** Provider name; appears in the log line and in the error. */
  name: string;
  failureThreshold?: number;
  /** How long the breaker stays open before it allows one trial call through. */
  resetAfterMs?: number;
  logger: Logger;
  /** Injected by tests so no test waits out a reset window. */
  now?: () => number;
}

export interface CircuitBreaker {
  run<T>(operation: string, call: () => Promise<T>): Promise<T>;
  state(): 'closed' | 'open' | 'half-open';
}

export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_RESET_AFTER_MS = 30_000;

/**
 * Only the provider's own unavailability counts. A 4xx means the provider answered and refused, and a
 * thrown TypeError is our bug: neither says anything about the provider's health, and counting them
 * would open the breaker for every user over one malformed request.
 */
const countsAsFailure = (error: unknown): boolean =>
  error instanceof ProviderUnavailableError ||
  (error instanceof ProviderHttpError && (error.status === 429 || error.status >= 500));

export function createCircuitBreaker({
  name,
  logger,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  resetAfterMs = DEFAULT_RESET_AFTER_MS,
  now = Date.now,
}: CircuitBreakerOptions): CircuitBreaker {
  let failures = 0;
  let openedAt: number | undefined;
  let probing = false;

  const state = (): 'closed' | 'open' | 'half-open' => {
    if (openedAt === undefined) return 'closed';
    return now() - openedAt > resetAfterMs ? 'half-open' : 'open';
  };

  return {
    state,
    async run<T>(operation: string, call: () => Promise<T>): Promise<T> {
      // Half-open admits exactly one caller. Admitting the whole backlog would send every waiting login
      // at the provider at once, which is the stampede the breaker stands in front of.
      if (state() === 'open' || (state() === 'half-open' && probing)) {
        throw new ProviderUnavailableError(name, operation, 'circuit-open');
      }
      probing = state() === 'half-open';
      try {
        const result = await call();
        if (openedAt !== undefined) logger.info({ provider: name, operation }, 'provider: circuit closed');
        failures = 0;
        openedAt = undefined;
        probing = false;
        return result;
      } catch (error) {
        probing = false;
        if (!countsAsFailure(error)) throw error;
        failures++;
        if (failures >= failureThreshold) {
          openedAt = now();
          logger.warn({ provider: name, operation, failures }, 'provider: circuit opened');
        }
        throw error;
      }
    },
  };
}
