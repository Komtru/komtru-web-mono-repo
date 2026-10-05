// Request and response shapes for the session routes (M1 §10.1).
import { sessionScopeSchema } from '@komtru/shared-types';
import { z } from 'zod';

/**
 * Strict on purpose. A body carrying `scope: 'STAFF'` is rejected rather than ignored: a client that
 * believes it can ask for a scope should be told it cannot, and the silent version of that is the
 * kind of thing that later becomes a real escalation when someone wires the field up.
 */
export const refreshRequestSchema = z.strictObject({
  refreshToken: z.string().min(1).max(512),
});

export const logoutRequestSchema = z.strictObject({
  refreshToken: z.string().min(1).max(512),
  allDevices: z.boolean().default(false),
});

/** The refresh token is NOT in here: it goes back in the httpOnly cookie the app's handler sets (S8). */
export const sessionResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  scope: sessionScopeSchema,
  expiresIn: z.number().int().positive(),
  /** Epoch milliseconds, so the client can pre-empt the 401 rather than wait for it. */
  expiresAt: z.number().int().positive(),
});

export const logoutResponseSchema = z.object({ ok: z.literal(true) });

/**
 * RFC 7517. The members of a JWK depend on its key type, so the schema says only that each key is an
 * object — the signer builds it from a public KeyObject, which is where the real guarantee lives.
 */
export const jwksResponseSchema = z.object({
  keys: z.array(z.record(z.string(), z.unknown())),
});
