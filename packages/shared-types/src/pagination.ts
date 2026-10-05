// Every list endpoint is paginated (design §4.4). Cursor pagination is the default; numbered pages
// are for admin tables that need "page 3 of 12" and a total.
import { z } from 'zod';

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

/** Numbered pages stop here; deeper offsets are slow and belong to cursor pagination. */
export const PAGE_NUMBER_MAX = 10_000;

/**
 * A whole number from a query string or JSON body. Strict on purpose: `z.coerce.number()` would
 * accept `0x10`, `1e1`, `" 5 "` and `true`. An empty value (`?limit=`) counts as absent, so the
 * default applies.
 */
const queryInt = (min: number, max: number, fallback: number) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
      .pipe(z.number().int().min(min).max(max))
      .default(fallback),
  );

const limit = queryInt(1, PAGE_LIMIT_MAX, PAGE_LIMIT_DEFAULT);

export const cursorPageRequestSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit,
});
export type CursorPageRequest = z.infer<typeof cursorPageRequestSchema>;

export const pageRequestSchema = z.object({
  page: queryInt(1, PAGE_NUMBER_MAX, 1),
  limit,
});
export type PageRequest = z.infer<typeof pageRequestSchema>;

/** A cursor page. `nextCursor` is `null` on the last page, never omitted. */
export const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export const pagedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    limit: z.number().int().min(1).max(PAGE_LIMIT_MAX),
    total: z.number().int().min(0),
  });

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
