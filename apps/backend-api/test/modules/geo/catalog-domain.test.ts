import { describe, expect, it } from 'vitest';
import { cleanAliases, nameCursorKey, readNameCursor } from '../../../src/modules/geo/domain/catalog.js';
import { encodeCursor, decodeCursor, type CursorKey } from '../../../src/platform/http/paginate.js';
import { ApiError } from '../../../src/platform/errors.js';

describe('cleanAliases', () => {
  it('normalises, dedupes, and drops empties and the city’s own name', () => {
    expect(cleanAliases(['PH', ' p-h ', 'Port Harcourt', '', '--', 'ph'], 'port harcourt')).toEqual([
      'ph',
      'p h',
    ]);
  });

  it('is empty for no aliases', () => {
    expect(cleanAliases(undefined, 'ikeja')).toEqual([]);
  });
});

describe('name cursors', () => {
  const id = '0190b0a0-0000-7000-8000-000000000001';

  it('round-trips through the platform codec', () => {
    const cursor = decodeCursor(encodeCursor(nameCursorKey({ normalisedName: 'ikeja', id })));
    expect(readNameCursor(cursor)).toEqual({ name: 'ikeja', id });
  });

  it('is absent for the first page', () => {
    expect(readNameCursor(undefined)).toBeUndefined();
  });

  it.each<CursorKey>([{ n: 'ikeja' }, { n: 5, id }, { n: 'ikeja', id: 'not-a-uuid' }, { x: 'y' }])(
    'rejects a cursor that is not this list’s: %j',
    (key) => {
      expect(() => readNameCursor(key)).toThrow(ApiError);
    },
  );
});
