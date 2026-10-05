// The Nigerian bank list, as last fetched from the provider.
//
// Design §4.4 puts every provider call in a job, so the list cannot be fetched on the request that
// needs it. A scheduled job refreshes it (`ledger.refresh-bank-list`) and the bank picker reads it from
// here. Redis rather than process memory because the refresh runs on one worker and the read happens on
// every API instance — a per-process cache would stay empty wherever the job did not run.
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { Bank } from '../domain/providerAdapter.js';

/** The platform's `komtru:` prefix is applied by the client (platform/redis/connections.ts). */
export const BANK_LIST_CACHE_KEY = 'ledger:bank-list';
/**
 * Three days, against a daily refresh. The TTL is a staleness bound, not an eviction schedule: a list
 * that survives two failed runs is worth far more than one that expires the moment the provider has a
 * bad morning, and bank codes change on the order of months. Exactly two intervals would be too tight —
 * the entry would expire at the same instant the second refresh is due.
 */
export const BANK_LIST_TTL_SECONDS = 72 * 60 * 60;

const cachedBanks = z.array(z.object({ name: z.string().min(1), code: z.string().min(1) }));

export interface BankListCache {
  /** The cached list, or null when there is none to read. */
  read(): Promise<Bank[] | null>;
  write(banks: Bank[]): Promise<void>;
}

export function createRedisBankListCache(redis: Redis, ttlSeconds = BANK_LIST_TTL_SECONDS): BankListCache {
  return {
    async read() {
      const stored = await redis.get(BANK_LIST_CACHE_KEY);
      if (stored === null) return null;
      // A value written by an older format reads as "nothing cached". The caller's fallback is to wait
      // for the next refresh; crashing it over a cache entry would be worse than being empty.
      const parsed = cachedBanks.safeParse(
        ((): unknown => {
          try {
            return JSON.parse(stored);
          } catch {
            return undefined;
          }
        })(),
      );
      return parsed.success ? parsed.data : null;
    },
    async write(banks) {
      // Validated on the way in as well as on the way out. The read side turns anything unrecognised
      // into `null`, so writing junk here would not crash anything — it would quietly empty the bank
      // picker for the whole TTL, which is the failure nobody notices until a seller calls support.
      const parsed = cachedBanks.safeParse(banks);
      if (!parsed.success) throw new Error('ledger: refusing to cache a malformed bank list');
      if (parsed.data.length === 0) throw new Error('ledger: refusing to cache an empty bank list');
      await redis.set(BANK_LIST_CACHE_KEY, JSON.stringify(parsed.data), 'EX', ttlSeconds);
    },
  };
}
