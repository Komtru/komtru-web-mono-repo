// Finding the other party (T-035): by handle, or by email or phone. Mirrors the backend's party routes.
//
// A miss and a person who chose not to be found answer identically (`found: false`), so a screen
// must never word a miss as "no such user": it says the person is not on Komtru, or hidden, and
// offers the invitation either way.
import { z } from 'zod';
import type { ApiClient } from './client.js';
import { defineEndpoint } from './contracts.js';

export const partyCardSchema = z.object({
  publicId: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  verificationLevel: z.string(),
  badges: z.array(z.string()),
  memberSince: z.string(),
  completedTrades: z.number(),
  isMerchant: z.boolean(),
  merchantName: z.string().nullable(),
  /** False for a certified merchant: they sell, they never buy (design §6.3). */
  canBuy: z.boolean(),
});
export type PartyCard = z.infer<typeof partyCardSchema>;

export const lookupResponseSchema = z.union([
  z.object({ found: z.literal(true), party: partyCardSchema }),
  z.object({ found: z.literal(false), canInvite: z.boolean(), maskedHint: z.null() }),
]);
export type LookupResult = z.infer<typeof lookupResponseSchema>;

/** Not retryable: every attempt is counted on purpose, and a replay would hide one. */
export const lookupPartyByUsername = defineEndpoint({
  method: 'get',
  path: '/parties/lookup',
  scope: 'CONSUMER',
  schema: { query: z.object({ username: z.string().min(1).max(32) }), response: lookupResponseSchema },
});

export const lookupPartyByContact = defineEndpoint({
  method: 'post',
  path: '/parties/lookup',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.object({
      email: z.string().min(3).max(254).optional(),
      phone: z.string().min(4).max(32).optional(),
    }),
    response: lookupResponseSchema,
  },
});

export type PartyChannel = 'USERNAME' | 'EMAIL' | 'PHONE';

/**
 * Which way of naming someone a typed string is: `@ada` or `ada` is a handle, anything with an `@` in
 * the middle an email, and digits (with the usual `+`, spaces and dashes) a phone. Anything else is
 * `undefined`, and the screen asks again rather than guessing.
 */
export function classifyParty(input: string): { channel: PartyChannel; value: string } | undefined {
  const text = input.trim();
  if (text === '') return undefined;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { channel: 'EMAIL', value: text.toLowerCase() };
  if (/^\+?[\d\s-]{7,20}$/.test(text)) return { channel: 'PHONE', value: text.replace(/[\s-]/g, '') };
  const handle = text.replace(/^@/, '');
  if (/^[A-Za-z][A-Za-z0-9_.]{2,31}$/.test(handle)) return { channel: 'USERNAME', value: handle };
  return undefined;
}

/** One call, whichever way the person was named. */
export const lookupParty = (
  client: ApiClient,
  who: { channel: PartyChannel; value: string },
  signal?: AbortSignal,
): Promise<LookupResult> => {
  const options = signal ? { signal } : {};
  if (who.channel === 'USERNAME') {
    return client.call(lookupPartyByUsername, { query: { username: who.value } }, options);
  }
  const body = who.channel === 'EMAIL' ? { email: who.value } : { phone: who.value };
  return client.call(lookupPartyByContact, { body }, options);
};
