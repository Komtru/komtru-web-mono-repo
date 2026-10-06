// Shared helpers for the notify module's integration tests.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { generatePublicId } from '../../../src/platform/identifiers.js';

/** The SQLSTATE of a rejected query, so a test asserts which rule fired rather than that one did. */
export const sqlState = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).code ?? 'no code';
  }
  return 'no error';
};

export const enumLabels = async (owner: pg.Pool, schema: string, name: string): Promise<string[]> => {
  const { rows } = await owner.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 AND t.typname = $2
      ORDER BY e.enumsortorder`,
    [schema, name],
  );
  return rows.map((row) => row.label);
};

/** A minimal identity.users row, for the soft `user_id` reference notifications carry. */
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

/** A verified, primary email for `userId`. Returns the address. */
export const insertVerifiedEmail = async (pool: pg.Pool, userId: string, email: string): Promise<string> => {
  await pool.query(
    `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
     VALUES ($1, $2, $2, true, now())`,
    [userId, email],
  );
  return email;
};

/** A verified, primary phone for `userId`. Returns the E.164 number. */
export const insertVerifiedPhone = async (pool: pg.Pool, userId: string, phone: string): Promise<string> => {
  await pool.query(
    `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
     VALUES ($1, $2, 'NG', true, now())`,
    [userId, phone],
  );
  return phone;
};

/** An ACTIVE device carrying a push token. */
export const insertDevice = async (pool: pg.Pool, userId: string, pushToken: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO identity.devices (user_id, device_fingerprint, push_token, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [userId, randomUUID(), pushToken],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insertDevice(): no row returned');
  return id;
};

export interface NotificationOverrides {
  [column: string]: unknown;
}

/** A notify.notifications row with every NOT NULL column filled. Returns its id. */
export const insertNotification = async (
  pool: pg.Pool,
  overrides: NotificationOverrides = {},
): Promise<string> => {
  const values: Record<string, unknown> = {
    id: randomUUID(),
    user_id: randomUUID(),
    event_id: randomUUID(),
    event_name: 'test.thing.happened',
    template_key: 'test.thing',
    template_version: 1,
    channel: 'EMAIL',
    category: 'ACCOUNT',
    rendered_body: 'body',
    ...overrides,
  };
  const columns = Object.keys(values);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO notify.notifications (${columns.join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING id`,
    Object.values(values),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insertNotification(): no row returned');
  return id;
};
