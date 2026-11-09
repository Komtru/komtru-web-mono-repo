/** What a page's `searchParams` resolves to in Next 15. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The first value of a query parameter that may repeat. */
export const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;
