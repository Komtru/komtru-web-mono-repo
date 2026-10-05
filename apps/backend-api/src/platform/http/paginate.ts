// Cursor pagination (design §4.4). A cursor is the sort key of the last row on the page, base64url
// encoded — opaque to the client, cheap for the database, and stable while rows are inserted, which
// an offset is not.
import { ApiError } from '../errors.js';
import type { Paginated } from '@komtru/shared-types';

export type CursorKey = Record<string, string | number | null>;

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
  return parsed as CursorKey;
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
