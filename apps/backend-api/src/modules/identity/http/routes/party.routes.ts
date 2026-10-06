// §10.4's five routes.
//
// Every one of them needs a CONSUMER session except the invitation preview, which is addressed by a
// 256-bit token and read by someone who by definition has no account yet.
//
// The rate limits are §8.3 control 3's per-minute halves, counted per user, per device and per IP so
// that all three trigger independently (§17). The per-IP budget is the LOOSE one here, which is the
// opposite of `/auth/register` and deliberately: behind Nigerian carrier-grade NAT one public
// address is thousands of unrelated subscribers, and ten lookups a minute for all of them is an
// outage for a large part of the market. The budget that actually binds an attacker is the per-user
// one, because reaching these routes at all costs a verified email AND a verified phone (§8.3
// control 2) — and the day and month horizons on that key live in `lookup-budget.ts`.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import {
  getInvitationByToken,
  getPartyByUsername,
  getPartySuggestions,
  postPartyInvite,
  postPartyLookup,
  type PartyControllerDeps,
} from '../controllers/party.controller.js';
import {
  invitationTokenParamsSchema,
  inviteBodySchema,
  invitePreviewResponseSchema,
  inviteResponseSchema,
  lookupBodySchema,
  lookupQuerySchema,
  lookupResponseSchema,
  suggestQuerySchema,
  suggestResponseSchema,
} from '../validations/party.validation.js';

const fingerprintFrom = ({ body, query }: { body: unknown; query: unknown }): string | undefined => {
  const source = (body ?? {}) as { deviceFingerprint?: unknown };
  const fallback = (query ?? {}) as { deviceFingerprint?: unknown };
  const value = source.deviceFingerprint ?? fallback.deviceFingerprint;
  return typeof value === 'string' ? value : undefined;
};

/** §8.3 control 3: "Username: 30/min". The IP window is loose for the CGNAT reason above. */
const USERNAME_LIMIT = {
  points: 30,
  durationSeconds: 60,
  by: ['user', 'ip', 'device'] as const,
  perKey: { ip: { points: 120, durationSeconds: 60 } },
  deviceFrom: fingerprintFrom,
};

/** §8.3 control 3: "Email/phone: 10/min". An address is not public the way a handle is. */
const CONTACT_LIMIT = {
  points: 10,
  durationSeconds: 60,
  by: ['user', 'ip', 'device'] as const,
  perKey: { ip: { points: 60, durationSeconds: 60 } },
  deviceFrom: fingerprintFrom,
};

export function partyRoutes(deps: PartyControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/parties/lookup',
      scope: 'CONSUMER',
      summary: 'Find a party by handle',
      rateLimit: { ...USERNAME_LIMIT, by: [...USERNAME_LIMIT.by] },
      schema: { query: lookupQuerySchema, response: lookupResponseSchema },
      handler: ({ req, actor, query }) => getPartyByUsername(deps, req, actor, query),
    }),

    defineRoute({
      method: 'post',
      path: '/parties/lookup',
      scope: 'CONSUMER',
      summary: 'Find a party by email address or phone number',
      /**
       * False. This is a read, and the §8.3 control 6 velocity event is SUPPOSED to count every
       * attempt: replaying an idempotency key to get a cached answer would let an attacker probe
       * without the pattern ever reaching Risk.
       */
      retryable: false,
      rateLimit: { ...CONTACT_LIMIT, by: [...CONTACT_LIMIT.by] },
      schema: { body: lookupBodySchema, response: lookupResponseSchema },
      handler: ({ req, actor, body }) => postPartyLookup(deps, req, actor, body),
    }),

    defineRoute({
      method: 'get',
      path: '/parties/suggest',
      scope: 'CONSUMER',
      summary: 'Typeahead over handles: three characters, prefix only, eight results',
      // No `paginated`, deliberately: see suggestResponseSchema. A cursor here is the namespace walk
      // §8.4's prefix rule exists to prevent.
      rateLimit: { ...USERNAME_LIMIT, by: [...USERNAME_LIMIT.by] },
      schema: { query: suggestQuerySchema, response: suggestResponseSchema },
      handler: ({ actor, query }) => getPartySuggestions(deps, actor, query),
    }),

    defineRoute({
      method: 'post',
      path: '/parties/invite',
      scope: 'CONSUMER',
      summary: 'Tag a party who has no account yet',
      status: 201,
      /** A repeat would create a SECOND live invitation to the same person for the same trade. */
      retryable: true,
      rateLimit: { ...CONTACT_LIMIT, by: [...CONTACT_LIMIT.by] },
      schema: { body: inviteBodySchema, response: inviteResponseSchema },
      handler: ({ actor, body }) => postPartyInvite(deps, actor, body),
    }),

    defineRoute({
      method: 'get',
      path: '/parties/invitations/:token',
      // PUBLIC: the audience is a person who does not have an account yet, which is the whole point
      // of an invitation. The 256-bit token is the credential.
      scope: 'PUBLIC',
      summary: 'What a claim link says: who invited you, to what, and until when',
      rateLimit: { points: 20, durationSeconds: 60, by: ['ip'] },
      schema: { params: invitationTokenParamsSchema, response: invitePreviewResponseSchema },
      handler: ({ params }) => getInvitationByToken(deps, params),
    }),
  ];
}
