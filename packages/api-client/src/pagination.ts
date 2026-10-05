// Cursor pagination is the platform default (design §4.4). `nextCursor` is `null` on the last page
// and never omitted, so `null` is the only stop condition anything here needs.
import type { Paginated } from '@komtru/shared-types';

/** TanStack Query ends an infinite query on `undefined`; the wire says `null`. */
export const nextPageParam = <T>(page: Paginated<T>): string | undefined => page.nextCursor ?? undefined;

export const flattenPages = <T>(pages: readonly Paginated<T>[]): T[] => pages.flatMap((page) => page.items);

export type FetchCursorPage<T> = (cursor: string | undefined) => Promise<Paginated<T>>;

/**
 * Walks pages until the last one. A server that keeps answering with the cursor it was given would
 * otherwise spin here forever, so a repeated cursor ends the walk.
 */
export async function* walkCursorPages<T>(fetchPage: FetchCursorPage<T>): AsyncGenerator<Paginated<T>> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    yield page;
    const next = nextPageParam(page);
    if (next === undefined || next === cursor) return;
    cursor = next;
  }
}

export async function collectCursorPages<T>(fetchPage: FetchCursorPage<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const page of walkCursorPages(fetchPage)) items.push(...page.items);
  return items;
}
