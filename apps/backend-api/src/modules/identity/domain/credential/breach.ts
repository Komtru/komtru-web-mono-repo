// Cannibalized from kumtru/backend-apis/src/modules/identity/domain/credential/breach.ts (T-001),
// adapted: the enabled flag, the logger and `fetch` are arguments rather than module-level imports
// of `@config/config` and `@modules/logger`, which is what lets the whole file be unit-tested
// without a network and without a process-wide configuration.
//
// Breach-corpus check by k-anonymity (§S2).
//
// The password's SHA-1 is computed locally, the FIRST FIVE hex characters are sent to the HIBP range
// API, and the response is a list of ~500–1000 suffixes we search ourselves. The full hash never
// leaves this process, so HaveIBeenPwned learns a 5-character prefix shared by hundreds of thousands
// of passwords and nothing else.
//
// SHA-1 here is not a security choice — it is the corpus's index. It is never stored and never used
// to protect anything.
import crypto from 'node:crypto';
import type { Logger } from '../../../../platform/logger.js';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';
const REQUEST_TIMEOUT_MS = 3_000;

export interface BreachResult {
  breached: boolean;
  /** How many times the password appears in the corpus. 0 when clean or when the check was skipped. */
  count: number;
  /**
   * True when the corpus could not be consulted (network failure, timeout, non-200).
   *
   * The caller must FAIL OPEN on this and fall back to the offline list in `policy.ts`. Failing
   * closed would mean an HIBP outage blocks every registration on the platform, which trades a
   * marginal security gain for a total availability loss.
   */
  checkUnavailable: boolean;
}

export interface BreachDeps {
  enabled: boolean;
  logger: Logger;
  /** Injected in tests; the global in production. */
  fetch?: typeof globalThis.fetch;
}

const CLEAN: BreachResult = Object.freeze({ breached: false, count: 0, checkUnavailable: false });
const UNAVAILABLE: BreachResult = Object.freeze({ breached: false, count: 0, checkUnavailable: true });

export const sha1Hex = (value: string): string =>
  crypto.createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();

/**
 * Parses the range response: one `SUFFIX:COUNT` per line, CRLF separated.
 *
 * The comparison is a plain string equality on the suffix rather than an `includes()` on the whole
 * body — a substring match against the raw payload would match a *count* that happened to contain
 * the suffix, and report a clean password as breached.
 */
export const findSuffixCount = (body: string, suffix: string): number => {
  for (const line of body.split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;

    if (line.slice(0, separator).trim().toUpperCase() === suffix) {
      return Number.parseInt(line.slice(separator + 1).trim(), 10) || 0;
    }
  }

  return 0;
};

export const checkPasswordBreached = async (deps: BreachDeps, password: string): Promise<BreachResult> => {
  if (!deps.enabled) return CLEAN;

  const digest = sha1Hex(password);
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await (deps.fetch ?? globalThis.fetch)(`${HIBP_RANGE_URL}/${prefix}`, {
      signal: controller.signal,
      headers: {
        // Asks HIBP to pad the response with random hashes, so the response SIZE does not leak how
        // many real matches the prefix has.
        'Add-Padding': 'true',
        'User-Agent': 'komtru-identity',
      },
    });

    if (!response.ok) {
      deps.logger.warn({ status: response.status }, 'breach corpus check returned non-200; failing open');
      return UNAVAILABLE;
    }

    const count = findSuffixCount(await response.text(), suffix);

    return { breached: count > 0, count, checkUnavailable: false };
  } catch (err: unknown) {
    // Never log the password, the digest, or the prefix — the prefix is weak, but §S12 is absolute.
    deps.logger.warn({ err }, 'breach corpus check unavailable; failing open to the offline list');
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
};
