// Turns a module's RouteDefinitions into Express handlers: rate limit, validate, idempotency gate,
// handler, response validation. Nothing else registers a route (design §4.4), so these steps cannot
// be forgotten on one endpoint.
import { cursorPageRequestSchema, pageRequestSchema } from '@komtru/shared-types';
import { type Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Logger } from '../logger.js';
import { assertRouteInvariants, routeLabel, type RouteDefinition } from './route.js';

/** What a retryable route's handler is wrapped in; supplied by idempotency.ts in the API process. */
export type IdempotencyGate = (
  context: { route: RouteDefinition; req: Request; res: Response; actor: string; body: unknown },
  run: () => Promise<{ status: number; body: unknown }>,
) => Promise<{ status: number; body: unknown }>;

/** What a rate-limited route is checked against; supplied by rateLimit.ts in the API process. */
export type RateLimitGate = (context: {
  route: RouteDefinition;
  req: Request;
  res: Response;
  actor: string;
  parsed: ParsedRequest;
}) => Promise<void>;

export interface ParsedRequest {
  params: unknown;
  query: unknown;
  body: unknown;
}

export interface MountDeps {
  logger: Logger;
  idempotency?: IdempotencyGate;
  rateLimit?: RateLimitGate;
  /** Resolves the caller. Sessions arrive in T-030; until then every caller is anonymous. */
  resolveActor?: (req: Request) => string;
}

export const ANONYMOUS_ACTOR = 'anon';

const EMPTY = z.object({});

/** Merges the route's own query schema with the pagination one, so both are parsed in one pass. */
const querySchema = (route: RouteDefinition): z.ZodType => {
  const own = route.schema.query;
  if (!route.paginated) return own ?? EMPTY;
  const paging = route.paginated === 'cursor' ? cursorPageRequestSchema : pageRequestSchema;
  if (!own) return paging;
  // Both are objects in every real case; fall back to an intersection for anything exotic.
  return own instanceof z.ZodObject ? paging.extend(own.shape) : z.intersection(paging, own);
};

export function mountRoutes(routes: RouteDefinition[], deps: MountDeps): (router: Router) => void {
  assertRouteInvariants(routes);
  const { logger, idempotency, rateLimit, resolveActor = () => ANONYMOUS_ACTOR } = deps;

  return (router: Router) => {
    for (const route of routes) {
      const query = querySchema(route);
      const defaultStatus = route.status ?? 200;

      router[route.method](route.path, async (req: Request, res: Response) => {
        const actor = resolveActor(req);
        const parsed: ParsedRequest = {
          params: (route.schema.params ?? EMPTY).parse(req.params),
          query: query.parse(req.query),
          body: (route.schema.body ?? z.unknown()).parse(req.body),
        };

        if (route.rateLimit && rateLimit) await rateLimit({ route, req, res, actor, parsed });

        const run = async (): Promise<{ status: number; body: unknown }> => {
          const result = await route.handler({ ...parsed, actor, req, res });
          const check = route.schema.response.safeParse(result);
          if (!check.success) {
            // The client did nothing wrong: this is the server breaking its own contract, so it is
            // a 500 and it goes to Sentry rather than being reported as a validation failure.
            logger.error(
              { route: routeLabel(route), issues: check.error.issues },
              'http: response did not match its schema',
            );
            throw new Error(`${routeLabel(route)} returned a response that does not match its schema`);
          }
          return { status: defaultStatus, body: check.data };
        };

        const { status, body } =
          route.retryable && idempotency
            ? await idempotency({ route, req, res, actor, body: parsed.body }, run)
            : await run();

        // A gate may already have answered (a 429 or a replay that streamed its own body).
        if (res.headersSent) return;
        res.status(status).json(body);
      });
    }
  };
}
