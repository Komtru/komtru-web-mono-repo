// Cursor pagination (design §4.4). A cursor is the sort key of the last row on the page, base64url
// encoded — opaque to the client, cheap for the database, and stable while rows are inserted, which
// an offset is not.
import { z } from 'zod';
import { ApiError } from '../errors.js';
import type { Paginated } from '@komtru/shared-types';

export type CursorKey = Record<string, string | number | null>;

/**
 * A cursor is a sort key, nothing more. Validated on the way back in, so a client cannot hand a
 * handler an object of its own choosing — a nested value would reach drizzle as a `where` operand,
 * and a scoping field in someone's cursor would be an authorization hole rather than a 422.
 */
const cursorKeySchema: z.ZodType<CursorKey> = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()]),
);

export const encodeCursor = (key: CursorKey): string =>
  Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');

/** A cursor the client invented or mangled is their mistake, so it is a 422 and never a 500. */
export function decodeCursor(cursor: string): CursorKey {
  const invalid = () =>
    new ApiError(422, 'VALIDATION_FAILED', 'Invalid cursor', 'Use the nextCursor from the previous page');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalid();
  const checked = cursorKeySchema.safeParse(parsed);
  if (!checked.success) throw invalid();
  return checked.data;
}

/**
 * Builds a page from `limit + 1` rows: the extra row is how the query proves another page exists
 * without a second count query.
 */
export function cursorPage<T>(rows: T[], limit: number, toCursor: (row: T) => CursorKey): Paginated<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(toCursor(last)) : null,
  };
}
