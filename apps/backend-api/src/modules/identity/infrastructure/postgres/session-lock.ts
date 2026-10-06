// Serialises every write to one user's sessions.
//
// Why this exists. Revoking a family is one `UPDATE ... WHERE family_id = $1 AND revoked_at IS NULL`.
// Under READ COMMITTED that statement's snapshot is taken when it starts; when it blocks on a row
// another transaction holds `FOR UPDATE`, Postgres re-checks *that row* through EvalPlanQual but
// never re-scans for rows inserted in the meantime. So a rotation committing beside a revoke leaves
// its freshly minted child alive — the revoke never saw it. That is a live session surviving a reuse
// alarm, a suspension, a password change or a logout-all-devices, and in the theft case the surviving
// token is the thief's. It is exactly the "epoch alone is not enough" failure M1 D5 names.
//
// A transaction-scoped advisory lock closes it: the loser waits, and when it proceeds its statement
// takes a fresh snapshot that includes the winner's child. `pg_advisory_xact_lock` is released by
// COMMIT or ROLLBACK and is the form PgBouncer's transaction pooling allows (eslint-rules/
// pgbouncer-safe.mjs sanctions it by name); it is also re-entrant, so taking it twice in one
// transaction is free.
//
// Taken BEFORE any row lock, always. Taking it after `SELECT ... FOR UPDATE` would let a rotation
// holding row N wait for the lock while a revoke holding the lock waits for row N — a deadlock
// Postgres would resolve by aborting someone's login.
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../../platform/events/publish.js';

/** Namespaced, so identity's locks can never collide with another module's. */
const LOCK_DOMAIN = 'identity.sessions:';

export async function lockUserSessions(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_DOMAIN} || ${userId}, 0))`);
}
