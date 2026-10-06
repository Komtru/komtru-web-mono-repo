// Reading a Postgres error back out of drizzle.
//
// drizzle-orm 0.45 does not hand the driver's error to the caller: it wraps it in a
// `DrizzleQueryError` carrying the SQL text, with the `pg` error on `cause`. So the obvious
// `catch (error) { if ((error as { code?: string }).code === '23505') … }` reads `undefined`, misses
// every constraint violation, and rethrows what the caller meant to translate — which surfaces as a
// 500 on a path that had a perfectly good 409 to give.
//
// T-060 found this first (`trades/infrastructure/postgres/tradeCodes.ts`) and T-040 after it; this
// is the shared version, so the next module does not have to rediscover it.
const UNIQUE_VIOLATION = '23505';

/** The fields of a `pg` DatabaseError this codebase keys decisions on. */
export interface PgErrorFields {
  code?: string;
  constraint?: string;
}

/**
 * Walks the `cause` chain for the first link carrying a SQLSTATE.
 *
 * Bounded by a self-reference check and a depth cap: a cause chain is built by libraries we do not
 * control, and an error handler is the last place that should be able to hang a request.
 */
export function pgErrorIn(error: unknown, maxDepth = 8): PgErrorFields | undefined {
  let current = error;
  const seen = new Set<unknown>();

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) return undefined;
    seen.add(current);

    const fields = current as PgErrorFields & { cause?: unknown };
    if (typeof fields.code === 'string') return { code: fields.code, constraint: fields.constraint };
    current = fields.cause;
  }
  return undefined;
}

/**
 * True when `error` is a unique violation on `constraint`, however deeply drizzle buried it.
 *
 * The constraint is matched by substring, because Postgres reports the index name and a partial
 * unique index is usually named for the rule rather than the table.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = pgErrorIn(error);
  return pg?.code === UNIQUE_VIOLATION && (pg.constraint ?? '').includes(constraint);
}
