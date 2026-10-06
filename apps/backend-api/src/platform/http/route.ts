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
import type { CursorKey } from './paginate.js';
import type { Actor } from './principal.js';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const MUTATING: readonly HttpMethod[] = ['post', 'put', 'patch', 'delete'];

/** `PUBLIC` is a route anyone may call (login, webhooks); the rest need a session of that scope. */
export type RouteScope = SessionScope | 'PUBLIC';

export interface RateLimitSpec {
  points: number;
  durationSeconds: number;
  /** Which keys the budget is counted against; every listed key is checked. */
  by: ('ip' | 'user' | 'identifier' | 'device')[];
  /** For `identifier`: pulls the email, phone or PIN subject out of the request. */
  identifierFrom?: (input: { body: unknown; query: unknown; params: unknown }) => string | undefined;
  /**
   * For `device`: pulls the client's device fingerprint out of the request.
   *
   * Behind Nigerian carrier-grade NAT one IP is thousands of unrelated people and one identifier is
   * one account, so neither key bounds the attacker who walks a list of identifiers from a single
   * handset — M1 §17 asks for all three to trigger independently. The fingerprint is a SIGNAL and
   * never an authenticator (§S15): it is spoofable, which costs an attacker one more thing to vary
   * and costs an honest client nothing.
   */
  deviceFrom?: (input: { body: unknown; query: unknown; params: unknown }) => string | undefined;
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
  /** The decoded cursor on a cursor-paginated route; the platform already rejected a bad one. */
  cursor?: CursorKey;
  /**
   * The caller, re-resolved from the database this request (T-031). `actor.principal` is null on a
   * PUBLIC route with no credential; on any scoped route mount.ts has already proved it is not.
   */
  actor: Actor;
  req: Request;
  res: Response;
}

/** What a handler sees once its own schemas are taken into account. */
export interface TypedRouteContext<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> {
  params: z.output<P>;
  query: z.output<Q> & { limit?: number; page?: number; cursor?: string };
  body: z.output<B>;
  cursor?: CursorKey;
  actor: Actor;
  req: Request;
  res: Response;
}

/** A route as its author writes it: schemas and handler types line up, with no casts at the call site. */
export interface TypedRoute<
  P extends z.ZodType = z.ZodUnknown,
  Q extends z.ZodType = z.ZodUnknown,
  B extends z.ZodType = z.ZodUnknown,
  R extends z.ZodType = z.ZodType,
> extends Omit<RouteDefinition, 'schema' | 'handler'> {
  schema: { params?: P; query?: Q; body?: B; response: R };
  handler: (ctx: TypedRouteContext<P, Q, B>) => Promise<z.input<R>>;
}

export interface RouteDefinition {
  method: HttpMethod;
  /** Mounted under `/v1`, so `/trades/:id` is `/v1/trades/:id`. */
  path: string;
  scope: RouteScope;
  /** One line, for the route table and the generated docs. */
  summary: string;
  /** RBAC permission from the catalogue (T-037). mountRoutes refuses the request without it. */
  permission?: string;
  /**
   * Required on every mutating route: `true` adds the idempotency middleware, `false` is a
   * deliberate statement that a repeat is harmless (or impossible) and needs no key.
   */
  retryable?: boolean;
  /** Required on any route returning a collection. */
  paginated?: 'cursor' | 'page';
  rateLimit?: RateLimitSpec;
  /** Defaults to 200; a route that creates something declares 201 itself. */
  status?: number;
  schema: RouteSchemas;
  handler: (ctx: RouteContext) => Promise<unknown>;
}

/**
 * Infers the handler's parameter types from the route's own schemas, then erases them: the registry
 * stores one uniform `RouteDefinition`, while the author gets `ctx.params.id` typed from the schema
 * instead of a cast that quietly rots when the schema changes.
 */
export const defineRoute = <
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType,
>(
  route: TypedRoute<P, Q, B, R>,
): RouteDefinition => route as unknown as RouteDefinition;

export const routeLabel = (route: RouteDefinition): string => `${route.method.toUpperCase()} ${route.path}`;

/**
 * Unwraps the wrappers a schema can be dressed in — `.transform()`, `.optional()`, `.readonly()`,
 * `z.lazy()` and friends — so a collection stays recognisable however it is spelled. Without this,
 * `paginatedSchema(x).transform(...)` would slip past the pagination invariant.
 */
const unwrap = (schema: z.ZodType, depth = 0): z.ZodType[] => {
  if (depth > 10) return [schema];
  const def = schema.def as {
    innerType?: z.ZodType;
    in?: z.ZodType;
    getter?: () => z.ZodType;
    options?: z.ZodType[];
  };
  if (def.options) return def.options.flatMap((option) => unwrap(option, depth + 1));
  const inner = def.innerType ?? def.in ?? (typeof def.getter === 'function' ? def.getter() : undefined);
  return inner ? unwrap(inner, depth + 1) : [schema];
};

/**
 * A response is a collection if it is an array, or an object with an `items` array — which is what
 * `paginatedSchema` and `pagedSchema` produce, so a route that uses them is recognised without
 * having to announce itself. A union counts if any branch does.
 */
export function isCollectionSchema(schema: z.ZodType): boolean {
  return unwrap(schema).some((candidate) => {
    if (candidate instanceof z.ZodArray) return true;
    if (candidate instanceof z.ZodObject) {
      const items: unknown = (candidate.shape as Record<string, unknown>).items;
      return items !== undefined && unwrap(items as z.ZodType).some((i) => i instanceof z.ZodArray);
    }
    return false;
  });
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
    if (route.path.includes(':') && !route.schema.params) {
      problems.push(`${label}: the path has parameters, so it needs a params schema`);
    }
    if (route.rateLimit?.by.includes('identifier') && !route.rateLimit.identifierFrom) {
      problems.push(`${label}: rate limits by identifier but provides no identifierFrom`);
    }
    if (route.rateLimit?.by.includes('device') && !route.rateLimit.deviceFrom) {
      problems.push(`${label}: rate limits by device but provides no deviceFrom`);
    }
    // A permission on a route anyone may call reads as protection and is never checked, which is
    // the worst of both: the same reasoning as the idempotency and rate-limit gates above.
    if (route.scope === 'PUBLIC' && route.permission) {
      problems.push(
        `${label}: declares permission "${route.permission}" on a PUBLIC route, where it can never be checked`,
      );
    }
  }

  if (problems.length) {
    throw new Error(`Route registry rejected ${problems.length} route(s):\n  ${problems.join('\n  ')}`);
  }
}
