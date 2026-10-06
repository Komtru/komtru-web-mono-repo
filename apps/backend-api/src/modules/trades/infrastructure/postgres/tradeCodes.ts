// Issuing a trade code that is actually free.
//
// Seven random digits is nine million codes, so collisions are not rare at scale: around 3,500
// trades a repeat is likelier than not. `trades_trade_code_unique` is what guarantees uniqueness,
// and this is the retry that guarantee needs to be usable — a comment promising a retry is not one.
// The retry runs in a savepoint, because a unique violation aborts the transaction it happened in
// and a caller mid-way through creating a trade has other work it must not lose.
import { ApiError } from '../../../../platform/errors.js';
import type { Tx } from '../../../../platform/events/publish.js';
import { generateTradeCode } from '../../domain/tradeCode.js';

const UNIQUE_VIOLATION = '23505';
const TRADE_CODE_CONSTRAINT = 'trades_trade_code_unique';

/** drizzle wraps a driver error in one of its own, so the chain is what has to be inspected. */
const isTradeCodeCollision = (error: unknown): boolean => {
  for (let cause = error; cause instanceof Error || (typeof cause === 'object' && cause !== null);) {
    const { code, constraint } = cause as { code?: string; constraint?: string };
    if (code === UNIQUE_VIOLATION && constraint === TRADE_CODE_CONSTRAINT) return true;
    const next: unknown = (cause as { cause?: unknown }).cause;
    if (next === undefined || next === cause) return false;
    cause = next;
  }
  return false;
};

export interface IssueTradeCodeOptions {
  attempts?: number;
  /** Injected by the tests, so a collision can be forced rather than waited for. */
  generate?: () => string;
}

/**
 * Runs `insert` with a free trade code, retrying only a collision on the trade code itself. Any
 * other error — a check constraint, a second unique index — is the caller's and propagates on the
 * first attempt, because retrying it would just fail again more slowly.
 */
export async function withTradeCode<T>(
  tx: Tx,
  insert: (tradeCode: string) => Promise<T>,
  options: IssueTradeCodeOptions = {},
): Promise<T> {
  const { attempts = 5, generate = generateTradeCode } = options;
  for (let attempt = 1; ; attempt += 1) {
    try {
      // A savepoint: without it the first collision would poison the caller's whole transaction.
      return await tx.transaction(() => insert(generate()));
    } catch (error) {
      if (!isTradeCodeCollision(error) || attempt >= attempts) {
        if (isTradeCodeCollision(error)) {
          throw new ApiError(409, 'CONFLICT', 'Could not issue a trade code', 'Please try again.');
        }
        throw error;
      }
    }
  }
}
