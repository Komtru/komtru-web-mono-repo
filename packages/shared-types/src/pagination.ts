// Every list endpoint is paginated (design §4.4). Cursor pagination is the default; numbered pages
// are for admin tables that need "page 3 of 12" and a total.
import { z } from 'zod';

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

const limit = z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT);

export const cursorPageRequestSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit,
});
export type CursorPageRequest = z.infer<typeof cursorPageRequestSchema>;

export const pageRequestSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
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
