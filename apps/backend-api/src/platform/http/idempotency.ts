// Idempotency keys (design §4.4). A client on a bad motor-park connection retries; the platform
// must answer with the first result rather than creating a second trade, payout or custody event.
//
// The durable record is `platform.idempotency_keys`, claimed with INSERT ... ON CONFLICT DO NOTHING
// before the handler runs and completed with the response afterwards. Redis holds only a short lock,
// so a duplicate that arrives while the first is still running waits instead of racing it; Redis
// losing that key costs a 409, never a double effect.
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { idempotencyKeys } from '../../db/platform-schema.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { IdempotencyGate } from './mount.js';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';
/** How long a duplicate waits for the first request to finish before it gives up with a 409. */
export const LOCK_WAIT_MS = 2_000;
/** A claim older than this with no response belongs to a process that died; it can be taken over. */
export const STALE_IN_FLIGHT_MS = 60_000;
const LOCK_TTL_MS = 60_000;
const POLL_MS = 25;

export interface IdempotencyOptions {
  db: Db;
  redis: Redis;
  logger: Logger;
  lockWaitMs?: number;
  staleInFlightMs?: number;
}

/** Method, path and body: the same key with a different request is a client bug, not a retry. */
const hashRequest = (req: Request, body: unknown): string =>
  createHash('sha256')
    .update(`${req.method}\n${req.baseUrl}${req.path}\n${JSON.stringify(body ?? null)}`)
    .digest('hex');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createIdempotencyGate({
  db,
  redis,
  logger,
  lockWaitMs = LOCK_WAIT_MS,
  staleInFlightMs = STALE_IN_FLIGHT_MS,
}: IdempotencyOptions): IdempotencyGate {
  return async ({ route, req, res, actor, body }, run) => {
    const key = req.get(IDEMPOTENCY_HEADER);
    // No key means the client is not asking for a retry guarantee, so there is nothing to store.
    if (!key) return run();

    const scope = route.scope;
    const requestHash = hashRequest(req, body);
    const where = and(
      eq(idempotencyKeys.scope, scope),
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.actor, actor),
    );
    const lockKey = `idem:${scope}:${actor}:${key}`;

    const claim = async (): Promise<boolean> => {
      const inserted = await db
        .insert(idempotencyKeys)
        .values({
          scope,
          key,
          actor,
          requestHash,
          method: req.method,
          path: `${req.baseUrl}${req.path}`,
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });
      return inserted.length > 0;
    };

    /** Retakes a claim whose owner never came back, so one dead process cannot burn a key forever. */
    const takeOverIfStale = async (): Promise<boolean> => {
      const taken = await db
        .update(idempotencyKeys)
        .set({ requestHash, createdAt: new Date(), method: req.method, path: `${req.baseUrl}${req.path}` })
        .where(
          and(
            where,
            sql`${idempotencyKeys.completedAt} IS NULL`,
            sql`${idempotencyKeys.createdAt} < now() - make_interval(secs => ${staleInFlightMs} / 1000.0)`,
          ),
        )
        .returning({ key: idempotencyKeys.key });
      return taken.length > 0;
    };

    const stored = async () => (await db.select().from(idempotencyKeys).where(where))[0];

    const complete = async (status: number, responseBody: unknown) => {
      await db
        .update(idempotencyKeys)
        .set({ status, response: responseBody, completedAt: new Date() })
        .where(where);
    };

    /** The handler failed: drop the claim so the client's retry runs instead of replaying an error. */
    const abandon = async () => {
      await db.delete(idempotencyKeys).where(and(where, sql`${idempotencyKeys.completedAt} IS NULL`));
    };

    const runOwned = async () => {
      // Best effort: the lock only shortens a duplicate's wait. The database row is what makes the
      // guarantee, so a Redis failure here must not fail the request.
      await redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX').catch((error: unknown) => {
        logger.warn({ err: error, route: route.path }, 'idempotency: could not take the lock');
      });
      try {
        const result = await run();
        await complete(result.status, result.body);
        return result;
      } catch (error) {
        await abandon().catch((cleanupError: unknown) => {
          logger.error({ err: cleanupError, key }, 'idempotency: could not release a failed claim');
        });
        throw error;
      } finally {
        await redis.del(lockKey).catch(() => undefined);
      }
    };

    if (await claim()) return runOwned();

    const existing = await stored();
    if (existing && existing.requestHash !== requestHash && existing.completedAt) {
      throw new ApiError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was used for a different request',
        'Use a new key for a new request, or resend the original body',
      );
    }

    if (existing?.completedAt) {
      res.setHeader(REPLAYED_HEADER, 'true');
      return { status: existing.status ?? 200, body: existing.response };
    }

    if (await takeOverIfStale()) return runOwned();

    // Someone else is mid-flight: wait on their lock for a short while, then answer the stored
    // response if it has landed.
    const deadline = Date.now() + lockWaitMs;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const row = await stored();
      if (row?.completedAt) {
        if (row.requestHash !== requestHash) {
          throw new ApiError(
            422,
            'IDEMPOTENCY_KEY_REUSED',
            'This idempotency key was used for a different request',
          );
        }
        res.setHeader(REPLAYED_HEADER, 'true');
        return { status: row.status ?? 200, body: row.response };
      }
    }

    throw new ApiError(
      409,
      'CONFLICT',
      'A request with this idempotency key is still in progress',
      'Retry in a moment to get its result',
    );
  };
}
