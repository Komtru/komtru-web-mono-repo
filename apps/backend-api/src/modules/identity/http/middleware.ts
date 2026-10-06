// The seam between the platform's enforcement and identity's resolution.
//
// There is no `authenticate({ scope })` router middleware here, and deliberately so: `defineRoute`
// is the only way a route reaches the registry, and `mountRoutes` checks `scope` and `permission`
// for every route it mounts. A per-router middleware is a thing somebody forgets to apply; this is
// not. What identity contributes is the answer to "who is this", which is what this file builds.
import type { Request } from 'express';
import { ANONYMOUS_ACTOR, rejectedActor, type Actor } from '../../../platform/http/principal.js';
import { resolvePrincipal, type PrincipalDeps } from '../services/principal.service.js';

const BEARER = /^Bearer (\S+)$/;

/** RFC 6750 §2.1. The header only; a token in a query string lands in access logs. */
export function bearerToken(req: Request): string | undefined {
  const header = req.get('authorization');
  return header === undefined ? undefined : (BEARER.exec(header)?.[1] ?? undefined);
}

export function createActorResolver(deps: PrincipalDeps): (req: Request) => Promise<Actor> {
  return async (req) => {
    const token = bearerToken(req);
    // No credential at all is not a failure: a PUBLIC route serves this caller, and a scoped one
    // answers 401 TOKEN_MISSING. An Authorization header this does not understand is a failure.
    if (token === undefined) {
      return req.get('authorization') === undefined ? ANONYMOUS_ACTOR : rejectedActor('TOKEN_INVALID');
    }
    return resolvePrincipal(deps, token);
  };
}
