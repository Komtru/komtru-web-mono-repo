// Idempotency keys (design §4.4). A client on a bad motor-park connection retries; the platform
// must answer with the first result rather than creating a second trade, payout or custody event.
//
// WHAT THIS GUARANTEES, EXACTLY: at most one *recorded* completion per (scope, key, actor), and a
// retry of the same request gets that recorded response. It cannot make a non-transactional handler
// exactly-once on its own — claim, run and complete are three statements, so a handler that writes
// outside its own transaction must still be written to be safely repeatable. Handlers that move
// money or custody state must do their work in one transaction.
//
// The durable record is `platform.idempotency_keys`, claimed with INSERT ... ON CONFLICT DO NOTHING
// before the handler runs and completed afterwards. Every write by an owner is fenced on `owner_id`,
// so an attempt that was taken over can neither overwrite the new owner's response nor delete its
// claim. Redis holds a lease that the owner renews while it works: a slow-but-alive handler is
// therefore never taken over, and a dead one's lease simply expires.
import { createHash, randomUUID } from 'node:crypto';
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
/** A claim with no live lease and older than this belongs to a process that died; it can be taken. */
export const STALE_IN_FLIGHT_MS = 60_000;
/** A completed record older than this is spent: the retry runs again rather than replaying. */
export const IDEMPOTENCY_TTL_HOURS = 24;
/** The owner's lease. Renewed while the handler runs, so only a dead owner's lease lapses. */
export const LEASE_TTL_MS = 30_000;
const LEASE_RENEW_MS = 10_000;
const POLL_MS = 25;
/** A key is a client-chosen token: bounded, printable, and never a place to smuggle bytes. */
const KEY_PATTERN = /^[\x21-\x7e]{8,255}$/;

export interface IdempotencyOptions {
  db: Db;
  redis: Redis;
  logger: Logger;
  lockWaitMs?: number;
  staleInFlightMs?: number;
  leaseTtlMs?: number;
  ttlHours?: number;
}

/** Method, path, query and body: the same key with a different request is a client bug, not a retry. */
const hashRequest = (req: Request, body: unknown): string =>
  createHash('sha256')
    .update(
      [
        req.method,
        `${req.baseUrl}${req.path}`,
        JSON.stringify(req.query ?? {}),
        JSON.stringify(body ?? null),
      ].join('\n'),
    )
    .digest('hex');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createIdempotencyGate({
  db,
  redis,
  logger,
  lockWaitMs = LOCK_WAIT_MS,
  staleInFlightMs = STALE_IN_FLIGHT_MS,
  leaseTtlMs = LEASE_TTL_MS,
  ttlHours = IDEMPOTENCY_TTL_HOURS,
}: IdempotencyOptions): IdempotencyGate {
  return async ({ route, req, res, actor: caller, body }, run) => {
    // The stable per-caller string: this is the table's `actor` column, not the whole principal.
    const actor = caller.key;
    const key = req.get(IDEMPOTENCY_HEADER);
    // No key means the client is not asking for a retry guarantee, so there is nothing to store.
    if (!key) return run();
    if (!KEY_PATTERN.test(key)) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'Invalid Idempotency-Key',
        'Use 8 to 255 printable ASCII characters, such as a UUID',
      );
    }

    const scope = route.scope;
    const requestHash = hashRequest(req, body);
    const ownerId = randomUUID();
    const where = and(
      eq(idempotencyKeys.scope, scope),
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.actor, actor),
    );
    const mine = and(where, eq(idempotencyKeys.ownerId, ownerId));
    const leaseKey = `idem:${scope}:${actor}:${key}`;
    const path = `${req.baseUrl}${req.path}`;

    const claim = async (): Promise<boolean> =>
      (
        await db
          .insert(idempotencyKeys)
          .values({ scope, key, actor, requestHash, ownerId, method: req.method, path })
          .onConflictDoNothing()
          .returning({ key: idempotencyKeys.key })
      ).length > 0;

    const stored = async () => (await db.select().from(idempotencyKeys).where(where))[0];

    const leaseHeld = async (): Promise<boolean> => {
      try {
        return (await redis.exists(leaseKey)) === 1;
      } catch (error) {
        // Redis cannot say. Assume the owner is alive: a needless 409 is cheaper than a double run.
        logger.warn({ err: error, route: route.path }, 'idempotency: could not read the lease');
        return true;
      }
    };

    /**
     * Retakes a claim whose owner is gone — no live lease, and old enough that this is not just a
     * lease written moments ago. One dead process must not burn a key forever.
     */
    const takeOverIfStale = async (): Promise<boolean> => {
      if (await leaseHeld()) return false;
      const taken = await db
        .update(idempotencyKeys)
        .set({
          requestHash,
          ownerId,
          method: req.method,
          path,
          // Postgres time, like the column default: an app clock skewed by minutes would otherwise
          // make every fresh takeover look instantly stale and let every retry take it again.
          createdAt: sql`now()`,
        })
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

    const runOwned = async () => {
      await redis.set(leaseKey, ownerId, 'PX', leaseTtlMs).catch((error: unknown) => {
        logger.warn({ err: error, route: route.path }, 'idempotency: could not take the lease');
      });
      const renew = setInterval(() => {
        void redis.set(leaseKey, ownerId, 'PX', leaseTtlMs).catch(() => undefined);
      }, LEASE_RENEW_MS);
      renew.unref();

      let result: { status: number; body: unknown };
      try {
        result = await run();
      } catch (error) {
        clearInterval(renew);
        // The handler failed, so there is nothing to replay: release the claim (only if it is still
        // ours) and let the client's retry run it again.
        await db
          .delete(idempotencyKeys)
          .where(and(mine, sql`${idempotencyKeys.completedAt} IS NULL`))
          .catch((cleanupError: unknown) => {
            logger.error({ err: cleanupError, key }, 'idempotency: could not release a failed claim');
          });
        await redis.del(leaseKey).catch(() => undefined);
        throw error;
      }
      clearInterval(renew);

      try {
        const completed = await db
          .update(idempotencyKeys)
          .set({ status: result.status, response: result.body, completedAt: sql`now()` })
          .where(mine)
          .returning({ key: idempotencyKeys.key });
        if (!completed.length) {
          // Someone took the claim over while this handler was running. Its work is done and the
          // caller gets its answer, but it must not overwrite the new owner's record.
          logger.error(
            { route: route.path, key, actor, ownerId },
            'idempotency: completion skipped, the claim was taken over',
          );
        }
      } catch (error) {
        // The work happened: never turn a storage failure into a 500 for a committed operation, and
        // never release the claim here — that would licence a second run.
        logger.error({ err: error, route: route.path, key }, 'idempotency: could not store the response');
      }
      await redis.del(leaseKey).catch(() => undefined);
      return result;
    };

    const expired = (completedAt: Date | null): boolean =>
      completedAt !== null && Date.now() - completedAt.getTime() > ttlHours * 60 * 60 * 1000;

    const reused = () =>
      new ApiError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was used for a different request',
        'Use a new key for a new request, or resend the original body',
      );

    const replay = (row: { status: number | null; response: unknown }) => {
      if (row.status === null) {
        throw new Error('idempotency: a completed record has no stored status');
      }
      res.setHeader(REPLAYED_HEADER, 'true');
      return { status: row.status, body: row.response };
    };

    if (await claim()) return runOwned();

    const existing = await stored();
    // A different request under the same key is a client bug whether or not the first has finished.
    if (existing && existing.requestHash !== requestHash && !expired(existing.completedAt)) {
      throw reused();
    }
    if (existing?.completedAt && !expired(existing.completedAt)) return replay(existing);

    // Spent record, or a claim whose owner is gone: this attempt owns it now. The predicate is the
    // age, evaluated in Postgres — comparing a JS Date to a timestamptz loses microseconds and would
    // never match.
    if (existing?.completedAt) {
      const retaken = await db
        .update(idempotencyKeys)
        .set({
          requestHash,
          ownerId,
          method: req.method,
          path,
          status: null,
          response: null,
          completedAt: null,
          createdAt: sql`now()`,
        })
        .where(and(where, sql`${idempotencyKeys.completedAt} < now() - make_interval(hours => ${ttlHours})`))
        .returning({ key: idempotencyKeys.key });
      if (retaken.length) return runOwned();
    } else if (await takeOverIfStale()) {
      return runOwned();
    }

    // Someone else is mid-flight: wait for their lease to drop or their response to land.
    const deadline = Date.now() + lockWaitMs;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      if (await leaseHeld()) continue;
      const row = await stored();
      if (row?.completedAt && !expired(row.completedAt)) {
        if (row.requestHash !== requestHash) throw reused();
        return replay(row);
      }
    }

    const row = await stored();
    if (row?.completedAt && !expired(row.completedAt)) {
      if (row.requestHash !== requestHash) throw reused();
      return replay(row);
    }

    throw new ApiError(
      409,
      'CONFLICT',
      'A request with this idempotency key is still in progress',
      'Retry in a moment to get its result',
    );
  };
}

/**
 * Deletes spent records. Nothing else bounds this table: an anonymous caller on a public retryable
 * route would otherwise write rows into Postgres forever.
 */
export async function pruneIdempotencyKeys(db: Db, ttlHours = IDEMPOTENCY_TTL_HOURS): Promise<number> {
  const { rowCount } = await db.execute(
    sql`DELETE FROM platform.idempotency_keys
         WHERE created_at < now() - make_interval(hours => ${ttlHours})`,
  );
  return rowCount ?? 0;
}
