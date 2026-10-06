// Request and response shapes for §10.4.
//
// Every body is `strictObject`, for T-031's reason on `/auth/refresh`: a field the server ignores is
// a field a client believes in.
import { z } from 'zod';
import { PARTY_BADGES } from '../../domain/party/card.js';
import { INVITED_ROLES } from '../../domain/invitation.js';
import { USERNAME_MAX_LENGTH } from '../../domain/username/policy.js';
import { deviceFingerprintSchema } from './registration.validation.js';

/**
 * The §8.2 card, declared field by field.
 *
 * `mountRoutes` parses every response against its schema, so this is also the last gate on the
 * "never returned by lookup, under any circumstance" list: a contact that somehow reached the card
 * would be stripped here rather than sent.
 */
export const partyCardSchema = z.object({
  publicId: z.string().min(1),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  verificationLevel: z.string().min(1),
  badges: z.array(z.enum(PARTY_BADGES)),
  memberSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completedTrades: z.number().int().min(0),
  isMerchant: z.boolean(),
  merchantName: z.string().nullable(),
  canBuy: z.boolean(),
});

/**
 * The two answers §10.4 defines, as a union rather than one object with optional members: an
 * optional `party` is an object a client reads before checking `found`.
 */
export const lookupResponseSchema = z.union([
  z.object({ found: z.literal(true), party: partyCardSchema }),
  z.object({
    found: z.literal(false),
    canInvite: z.boolean(),
    /**
     * Always null. §10.4 reserves the field; filling it with anything derived from an account we
     * declined to reveal would hand back what the `found: false` withheld.
     */
    maskedHint: z.null(),
  }),
]);

export const lookupQuerySchema = z.object({
  username: z
    .string()
    .min(1)
    .max(USERNAME_MAX_LENGTH + 2),
  deviceFingerprint: deviceFingerprintSchema.optional(),
});

/**
 * An email or a phone, in the BODY and never the query string: a query string reaches the access
 * log, the browser's history and every proxy in between, and §S12 does not allow an address in
 * anything we keep.
 */
export const lookupBodySchema = z
  .strictObject({
    email: z.string().min(3).max(254).optional(),
    phone: z.string().min(4).max(32).optional(),
    deviceFingerprint: deviceFingerprintSchema.optional(),
  })
  .check((ctx) => {
    const { email, phone } = ctx.value;
    if ((email === undefined) === (phone === undefined)) {
      ctx.issues.push({
        code: 'custom',
        message: 'send exactly one of email or phone',
        input: ctx.value,
        path: ['email'],
      });
    }
  });

export const suggestQuerySchema = z.object({
  /**
   * No minimum here, deliberately: §8.4's three characters is the SERVICE's rule, so a client typing
   * "ja" gets an empty list rather than a 422 that its UI would have to special-case.
   */
  q: z.string().max(USERNAME_MAX_LENGTH + 2),
  deviceFingerprint: deviceFingerprintSchema.optional(),
});

/**
 * Not `z.array(...)` and not `{ items: [...] }`, and NOT paginated.
 *
 * §8.4 caps the typeahead at eight results and allows prefix matching only, precisely so that the
 * namespace cannot be walked. A cursor or a page number would hand that walk straight back, so this
 * route declares no pagination — which `assertRouteInvariants` only permits for a response that is
 * not a bare collection. The shape is therefore deliberate and `party.routes.test.ts` pins it.
 */
export const suggestResponseSchema = z.object({
  query: z.string(),
  parties: z.array(partyCardSchema),
});

export const inviteBodySchema = z.strictObject({
  channel: z.enum(['EMAIL', 'PHONE']),
  destination: z.string().min(3).max(254),
  intendedRole: z.enum(INVITED_ROLES),
  context: z.strictObject({ type: z.literal('TRADE'), id: z.uuid() }).optional(),
  deviceFingerprint: deviceFingerprintSchema.optional(),
});

export const inviteResponseSchema = z.object({
  invitationId: z.uuid(),
  /** The claim link's secret. The client builds the URL; the API does not own the web app's routes. */
  token: z.string().min(1),
  maskedDestination: z.string().min(1),
  expiresAt: z.number().int().positive(),
});

/** No `contextId`: a trade id is the inviter's and M7's, not the token holder's. */
export const invitePreviewResponseSchema = z.object({
  status: z.string().min(1),
  intendedRole: z.enum(INVITED_ROLES),
  maskedDestination: z.string().min(1),
  inviterUsername: z.string().nullable(),
  inviterDisplayName: z.string().nullable(),
  contextType: z.string().nullable(),
  expiresAt: z.number().int().positive(),
});

export const invitationTokenParamsSchema = z.object({ token: z.string().min(16).max(128) });
