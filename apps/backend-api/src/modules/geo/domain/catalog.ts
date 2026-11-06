// The small pure rules the services share: how aliases are cleaned, and how a page cursor is read.
import { normaliseCityName } from '@komtru/shared-types';
import { ApiError } from '../../../platform/errors.js';
import type { CursorKey } from '../../../platform/http/paginate.js';

export const MAX_ALIASES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Aliases are stored as normalised search keys: cleaned, deduplicated, and never the city's own
 * name (which the typeahead already matches). Input order is kept.
 */
export function cleanAliases(aliases: readonly string[] | undefined, ownNormalisedName: string): string[] {
  const out: string[] = [];
  for (const raw of aliases ?? []) {
    const key = normaliseCityName(raw);
    if (key.length > 0 && key !== ownNormalisedName && !out.includes(key)) out.push(key);
  }
  return out;
}

export interface NameCursor {
  name: string;
  id: string;
}

/** The sort key the geo lists page on: normalised name, then id as the tiebreak. */
export const nameCursorKey = (row: { normalisedName: string; id: string }): CursorKey => ({
  n: row.normalisedName,
  id: row.id,
});

/**
 * The platform already proved a cursor is a flat record of strings and numbers; this proves it is
 * THIS list's cursor. A cursor lifted from another endpoint is the client's mistake, a 422.
 */
export function readNameCursor(cursor: CursorKey | undefined): NameCursor | undefined {
  if (cursor === undefined) return undefined;
  const { n, id } = cursor;
  if (typeof n !== 'string' || typeof id !== 'string' || !UUID.test(id)) throw invalidCursor();
  return { name: n, id };
}

const invalidCursor = () =>
  new ApiError(422, 'VALIDATION_FAILED', 'Invalid cursor', 'Use the nextCursor from the previous page');

export interface TimeCursor {
  at: string;
  id: string;
}

/** The sort key of the city-request queue: created-at (ISO), then id. */
export function readTimeCursor(cursor: CursorKey | undefined): TimeCursor | undefined {
  if (cursor === undefined) return undefined;
  const { t, id } = cursor;
  if (typeof t !== 'string' || typeof id !== 'string' || !UUID.test(id) || Number.isNaN(Date.parse(t))) {
    throw invalidCursor();
  }
  return { at: t, id };
}
