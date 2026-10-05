import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/platform/errors.js';
import { cursorPage, decodeCursor, encodeCursor } from '../../../src/platform/http/paginate.js';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, createdAt: `2026-10-0${i + 1}` }));

describe('cursors', () => {
  it('round-trips a key', () => {
    const cursor = encodeCursor({ id: 7, createdAt: '2026-10-05T09:30:00.000Z' });
    expect(decodeCursor(cursor)).toEqual({ id: 7, createdAt: '2026-10-05T09:30:00.000Z' });
  });

  it('is url-safe', () => {
    expect(encodeCursor({ q: 'a+b/c?d=e&f' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('answers a tampered cursor with 422, never a 500', () => {
    for (const bad of ['not-base64!!', 'bm90LWpzb24', encodeCursor(['array'] as never)]) {
      expect(() => decodeCursor(bad)).toThrow(ApiError);
      try {
        decodeCursor(bad);
      } catch (error) {
        expect((error as ApiError).status).toBe(422);
        expect((error as ApiError).code).toBe('VALIDATION_FAILED');
      }
    }
  });
});

describe('cursorPage', () => {
  it('returns the page and the cursor for the next one when more rows exist', () => {
    // The caller fetches limit + 1 rows; the extra one is the proof there is another page.
    const page = cursorPage(rows(4), 3, (row) => ({ id: row.id }));
    expect(page.items).toHaveLength(3);
    expect(page.items.map((r) => r.id)).toEqual([0, 1, 2]);
    expect(decodeCursor(page.nextCursor as string)).toEqual({ id: 2 });
  });

  it('ends with a null cursor, never an omitted one', () => {
    const page = cursorPage(rows(2), 3, (row) => ({ id: row.id }));
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty page', () => {
    expect(cursorPage([], 20, () => ({}))).toEqual({ items: [], nextCursor: null });
  });
});
