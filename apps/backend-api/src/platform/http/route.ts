// Every route in the platform is declared here, once, with the decisions design §4.4 requires:
// which scope may call it, whether a list is paginated, whether a retry is safe, what it rate
// limits on, and the zod schemas for what goes in and comes out.
//
// The point of making this the only way to register a route is that the invariants are checked at
// boot (assertRouteInvariants, called by mountRoutes), so "we forgot to paginate that admin list"
// fails the process rather than reaching production.
import type { SessionScope } from '@komtru/shared-types';
import type { Request, Response } from 'express';
import { z } from 'zod';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const MUTATING: readonly HttpMethod[] = ['post', 'put', 'patch', 'delete'];

/** `PUBLIC` is a route anyone may call (login, webhooks); the rest need a session of that scope. */
export type RouteScope = SessionScope | 'PUBLIC';

export interface RateLimitSpec {
  points: number;
  durationSeconds: number;
  /** Which keys the budget is counted against; every listed key is checked. */
  by: ('ip' | 'user' | 'identifier')[];
  /** For `identifier`: pulls the email, phone or PIN subject out of the request. */
  identifierFrom?: (input: { body: unknown; query: unknown; params: unknown }) => string | undefined;
}

export interface RouteSchemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
}

export interface RouteContext {
  params: unknown;
  query: unknown;
  body: unknown;
  /** `user:<uuid>` or `anon` until sessions land (T-030). */
  actor: string;
  req: Request;
  res: Response;
}

export interface RouteDefinition {
  method: HttpMethod;
  /** Mounted under `/v1`, so `/trades/:id` is `/v1/trades/:id`. */
  path: string;
  scope: RouteScope;
  /** One line, for the route table and the generated docs. */
  summary: string;
  /** RBAC permission from the catalogue (T-033); checked once sessions exist. */
  permission?: string;
  /**
   * Required on every mutating route: `true` adds the idempotency middleware, `false` is a
   * deliberate statement that a repeat is harmless (or impossible) and needs no key.
   */
  retryable?: boolean;
  /** Required on any route returning a collection. */
  paginated?: 'cursor' | 'page';
  rateLimit?: RateLimitSpec;
  /** Defaults to 200, or 201 on a POST that declares one. */
  status?: number;
  schema: RouteSchemas;
  handler: (ctx: RouteContext) => Promise<unknown>;
}

export const defineRoute = (route: RouteDefinition): RouteDefinition => route;

export const routeLabel = (route: RouteDefinition): string => `${route.method.toUpperCase()} ${route.path}`;

/**
 * A response is a collection if it is an array, or an object with an `items` array — which is what
 * `paginatedSchema` and `pagedSchema` produce, so a route that uses them is recognised without
 * having to announce itself.
 */
export function isCollectionSchema(schema: z.ZodType): boolean {
  if (schema instanceof z.ZodArray) return true;
  if (schema instanceof z.ZodObject) {
    const items: unknown = (schema.shape as Record<string, unknown>).items;
    return items instanceof z.ZodArray;
  }
  return false;
}

/** Throws one error naming every route that breaks a rule, so a boot failure is fixed in one pass. */
export function assertRouteInvariants(routes: RouteDefinition[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const route of routes) {
    const label = routeLabel(route);
    if (!route.path.startsWith('/')) problems.push(`${label}: path must start with "/"`);
    if (seen.has(label)) problems.push(`duplicate route ${label}`);
    seen.add(label);

    const collection = isCollectionSchema(route.schema.response);
    if (collection && !route.paginated) {
      problems.push(
        `${label}: returns a collection, so it must declare paginated: 'cursor' | 'page' (design §4.4)`,
      );
    }
    if (!collection && route.paginated) {
      problems.push(`${label}: declares pagination but does not return a collection`);
    }
    if (MUTATING.includes(route.method) && route.retryable === undefined) {
      problems.push(
        `${label}: mutating routes must decide retryable: true (idempotency key) or false (a repeat is harmless)`,
      );
    }
    if (route.rateLimit?.by.includes('identifier') && !route.rateLimit.identifierFrom) {
      problems.push(`${label}: rate limits by identifier but provides no identifierFrom`);
    }
  }

  if (problems.length) {
    throw new Error(`Route registry rejected ${problems.length} route(s):\n  ${problems.join('\n  ')}`);
  }
}
