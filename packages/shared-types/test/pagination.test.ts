import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  cursorPageRequestSchema,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  pageRequestSchema,
  pagedSchema,
  paginatedSchema,
} from '../src/pagination.js';

describe('cursorPageRequestSchema', () => {
  it('defaults the limit to 20 and leaves the cursor optional', () => {
    expect(PAGE_LIMIT_DEFAULT).toBe(20);
    expect(cursorPageRequestSchema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces a query-string limit', () => {
    expect(cursorPageRequestSchema.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
  });

  it.each([0, 101, 'abc', 2.5, -1])('rejects limit %j', (limit) => {
    expect(PAGE_LIMIT_MAX).toBe(100);
    expect(cursorPageRequestSchema.safeParse({ limit }).success).toBe(false);
  });

  it('rejects an empty cursor', () => {
    expect(cursorPageRequestSchema.safeParse({ cursor: '' }).success).toBe(false);
  });
});

describe('pageRequestSchema', () => {
  it('defaults to page 1 and coerces strings', () => {
    expect(pageRequestSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(pageRequestSchema.parse({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10 });
  });

  it('rejects page 0', () => {
    expect(pageRequestSchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe('page response schemas', () => {
  const item = z.object({ id: z.string() });

  it('parses a cursor page and requires nextCursor (null on the last page)', () => {
    const schema = paginatedSchema(item);
    expect(schema.parse({ items: [{ id: 'a' }], nextCursor: null })).toEqual({
      items: [{ id: 'a' }],
      nextCursor: null,
    });
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });

  it('parses a numbered page with its total', () => {
    const schema = pagedSchema(item);
    expect(schema.parse({ items: [], page: 1, limit: 20, total: 0 })).toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
    });
  });
});
