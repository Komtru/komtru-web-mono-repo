// §10.4 as HTTP. No logic beyond turning a service outcome into a status code — and, for lookup,
// turning what the client typed into a canonical key before the service ever sees it.
import type { Request } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import {
  lookupKeyForEmail,
  lookupKeyForPhone,
  lookupKeyForUsername,
  type LookupKey,
} from '../../domain/party/lookup.js';
import {
  createInvitation,
  previewInvitation,
  type InvitationDeps,
} from '../../services/invitation.service.js';
import { lookupParty, suggestParties, type PartyDeps } from '../../services/party.service.js';
import type {
  inviteBodySchema,
  lookupBodySchema,
  lookupQuerySchema,
  suggestQuerySchema,
} from '../validations/party.validation.js';
import { callerIp } from './request.js';

export type PartyControllerDeps = PartyDeps & InvitationDeps;

const FIND_PEOPLE = 'Sign in to find the other party to a trade';

/**
 * A value the normalisers cannot canonicalise is answered as a MISS, not as a 422.
 *
 * `jane@@example` matches nobody, and so does `jane@example.com` when nobody holds it. Returning 422
 * for the first and 200 for the second would let a caller sort inputs into "could exist" and "could
 * not", which is a weaker oracle than the one §8 closes but an oracle all the same — and the client
 * gains nothing from the distinction, because its next step is the same either way.
 */
const MISS_FOR = (canInvite: boolean) => ({ found: false as const, canInvite, maskedHint: null });

export async function getPartyByUsername(
  deps: PartyControllerDeps,
  req: Request,
  actor: Actor,
  query: z.output<typeof lookupQuerySchema>,
) {
  const key = lookupKeyForUsername(query.username);
  return key ? await lookup(deps, req, actor, key) : MISS_FOR(false);
}

export async function postPartyLookup(
  deps: PartyControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof lookupBodySchema>,
) {
  const key = body.email ? lookupKeyForEmail(body.email) : lookupKeyForPhone(body.phone ?? '');
  return key ? await lookup(deps, req, actor, key) : MISS_FOR(true);
}

const lookup = (deps: PartyControllerDeps, req: Request, actor: Actor, key: LookupKey) =>
  lookupParty(deps, {
    actorUserId: requireUserId(actor, FIND_PEOPLE),
    ip: callerIp(req),
    key,
  });

export async function getPartySuggestions(
  deps: PartyControllerDeps,
  actor: Actor,
  query: z.output<typeof suggestQuerySchema>,
) {
  const { parties } = await suggestParties(deps, {
    actorUserId: requireUserId(actor, FIND_PEOPLE),
    prefix: query.q,
  });
  return { query: query.q, parties };
}

export async function postPartyInvite(
  deps: PartyControllerDeps,
  actor: Actor,
  body: z.output<typeof inviteBodySchema>,
) {
  const result = await createInvitation(deps, {
    inviterUserId: requireUserId(actor, 'Sign in to invite someone to a trade'),
    channel: body.channel,
    destination: body.destination,
    intendedRole: body.intendedRole,
    ...(body.context ? { context: body.context } : {}),
  });

  if (result.outcome === 'INVALID_DESTINATION') {
    throw new ApiError(422, 'VALIDATION_FAILED', 'That contact is not valid', undefined, [
      {
        path: 'destination',
        message:
          body.channel === 'EMAIL'
            ? 'Enter a deliverable email address'
            : 'Enter a valid phone number, for example 0802 341 5567',
      },
    ]);
  }
  if (result.outcome === 'SELF') {
    throw new ApiError(422, 'VALIDATION_FAILED', 'That is your own contact', undefined, [
      { path: 'destination', message: 'You cannot be both parties to a trade' },
    ]);
  }

  return {
    invitationId: result.invitationId,
    token: result.token,
    maskedDestination: result.maskedDestination,
    expiresAt: result.expiresAt.getTime(),
  };
}

export async function getInvitationByToken(deps: PartyControllerDeps, params: { token: string }) {
  const preview = await previewInvitation(deps, params.token);
  // 404 and not a uniform answer: the token is 256 bits of randomness, so there is no space to
  // enumerate and nothing is revealed by saying a link is not one we issued.
  if (!preview) throw new ApiError(404, 'NOT_FOUND', 'That invitation link is not valid');

  return { ...preview, expiresAt: preview.expiresAt.getTime() };
}
