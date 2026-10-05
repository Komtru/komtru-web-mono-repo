// Shared helpers for the identity schema's integration tests.
import type pg from 'pg';
import { generatePublicId } from '../../../../../src/platform/identifiers.js';

/** The SQLSTATE of a rejected query, so a test asserts which rule fired rather than that one did. */
export const sqlState = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).code ?? 'no code';
  }
  return 'no error';
};

/** The constraint a rejected query violated, for the checks that share a SQLSTATE. */
export const constraintName = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).constraint ?? 'no constraint';
  }
  return 'no error';
};

/** The message of a rejected query, for the rules a trigger raises rather than a constraint. */
export const errorMessage = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as Error).message;
  }
  return 'no error';
};

export const enumLabels = async (owner: pg.Pool, name: string): Promise<string[]> => {
  const { rows } = await owner.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'identity' AND t.typname = $1
      ORDER BY e.enumsortorder`,
    [name],
  );
  return rows.map((row) => row.label);
};

/** A minimal users row. Returns its id. */
export const insertUser = async (pool: pg.Pool, overrides: Record<string, unknown> = {}): Promise<string> => {
  const values: Record<string, unknown> = { public_id: generatePublicId(), ...overrides };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO identity.users (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    Object.values(values),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insertUser(): no row returned');
  return id;
};
