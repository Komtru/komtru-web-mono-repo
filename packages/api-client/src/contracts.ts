// An endpoint is the client's half of a backend route. The shape mirrors
// `apps/backend-api/src/platform/http/route.ts` field for field — method, path, scope, retryable,
// paginated and the zod schemas — so a module's route definition and its endpoint definition can be
// read side by side, and eventually generated from one declaration.
import type { SessionScope } from '@komtru/shared-types';
import type { z } from 'zod';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** `PUBLIC` is called without a bearer token; every other scope needs a session of that scope. */
export type EndpointScope = SessionScope | 'PUBLIC';

export interface EndpointSchemas<
  P extends z.ZodType = z.ZodType,
  Q extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  params?: P;
  query?: Q;
  body?: B;
  response: R;
}

/** An endpoint's metadata, with no schemas: what the client needs to decide how to call it. */
export interface EndpointDefinition {
  method: HttpMethod;
  /** Relative to the client's base URL, with `:name` placeholders: `/trades/:id`. */
  path: string;
  scope: EndpointScope;
  /**
   * Mirrors the route's own `retryable`. `true` is the backend saying "this route is guarded by an
   * idempotency key", which is the only condition under which this client retries a mutation.
   */
  retryable?: boolean;
  paginated?: 'cursor' | 'page';
}

export interface Endpoint<
  P extends z.ZodType = z.ZodType,
  Q extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> extends EndpointDefinition {
  schema: EndpointSchemas<P, Q, B, R>;
}

export type AnyEndpoint = Endpoint;

export const defineEndpoint = <
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType,
>(
  endpoint: Endpoint<P, Q, B, R>,
): Endpoint<P, Q, B, R> => endpoint;

/** Everything a caller supplies for one call, with the members the endpoint has no schema for omitted. */
export type EndpointInput<E extends AnyEndpoint> = (E['schema']['params'] extends z.ZodType
  ? { params: z.input<NonNullable<E['schema']['params']>> }
  : { params?: undefined }) &
  (E['schema']['query'] extends z.ZodType
    ? { query: z.input<NonNullable<E['schema']['query']>> }
    : { query?: undefined }) &
  (E['schema']['body'] extends z.ZodType
    ? { body: z.input<NonNullable<E['schema']['body']>> }
    : { body?: undefined });

export type EndpointOutput<E extends AnyEndpoint> = z.output<E['schema']['response']>;

export const endpointLabel = (endpoint: AnyEndpoint): string =>
  `${endpoint.method.toUpperCase()} ${endpoint.path}`;

const PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

export function buildPath(template: string, params: Record<string, string | number> | undefined): string {
  return template.replace(PARAM, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === '') {
      throw new TypeError(`Missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}

/**
 * Query values are flattened the way express and `cursorPageRequestSchema` expect them: repeated
 * keys for arrays, `undefined` and `null` omitted entirely so a cleared filter is absent rather
 * than the string "undefined".
 */
export function buildQuery(query: unknown): string {
  if (query === undefined || query === null) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue;
      search.append(key, String(item));
    }
  }
  const serialised = search.toString();
  return serialised === '' ? '' : `?${serialised}`;
}
