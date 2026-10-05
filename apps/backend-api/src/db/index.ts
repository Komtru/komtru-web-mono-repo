// The database layer's public surface. Each module declares its tables in
// src/modules/<name>/schema.ts under its own pgSchema; nothing lives in `public`.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

export type Db = NodePgDatabase;

/** Wraps the shared runtime pool (komtru_app, through PgBouncer). */
export const createDb = (pool: pg.Pool): Db => drizzle(pool);

export { appendOnly } from './helpers/appendOnly.js';
export { APPEND_ONLY_TRIGGER, RUNTIME_ROLE, RuntimeRoleError, assertNotOwner } from './roles.js';
