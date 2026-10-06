// Firebase Cloud Messaging HTTP v1. Network code, so this file may be imported only from
// notify/jobs/.
//
// Two calls, not one: FCM v1 wants an OAuth2 access token, obtained by signing a JWT with the
// service account's key and exchanging it. The token is cached in process for its lifetime — not in
// Redis, because it is cheap to re-mint and a shared cache is one more place a credential lives.
import { createSign } from 'node:crypto';
import { ProviderHttpError, providerRequest } from '../../../../platform/providers/http.js';
import type { Logger } from '../../../../platform/logger.js';

export const FCM_BASE_URL = 'https://fcm.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const ASSERTION_LIFETIME_SECONDS = 3600;
/** Re-minted this long before expiry, so a token never expires mid-send. */
const TOKEN_SKEW_SECONDS = 60;
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/**
 * A device token FCM will not accept again. The caller retires it; this client never writes, and
 * one dead phone must not fail a notification the user's other devices did receive.
 */
const DEAD_TOKEN_STATUSES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND']);

export interface SendPushOptions {
  baseUrl?: string;
  tokenUri: string;
  projectId: string;
  clientEmail: string;
  privateKey: string;
  /** One message per device: FCM v1 has no multicast endpoint. */
  tokens: string[];
  title: string;
  body: string;
}

export interface SendPushResult {
  /** The first accepted message's name; enough to find the send in FCM's own logs. */
  providerReference: string | undefined;
  invalidTokens: string[];
}

interface CachedToken {
  accessToken: string;
  /** Unix seconds. */
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

const base64url = (value: Buffer | string): string =>
  (typeof value === 'string' ? Buffer.from(value) : value).toString('base64url');

/** The signed assertion Google exchanges for an access token. */
function assertion(options: SendPushOptions, now: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: options.clientEmail,
      scope: SCOPE,
      aud: options.tokenUri,
      iat: now,
      exp: now + ASSERTION_LIFETIME_SECONDS,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64url(signer.sign(options.privateKey))}`;
}

async function accessToken(logger: Logger, options: SendPushOptions): Promise<string> {
  const key = `${options.tokenUri}|${options.clientEmail}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > now + TOKEN_SKEW_SECONDS) return cached.accessToken;

  const form = new URLSearchParams({
    grant_type: JWT_BEARER_GRANT,
    assertion: assertion(options, now),
  }).toString();

  const response = await providerRequest<{ access_token?: string; expires_in?: number }>(logger, {
    provider: 'fcm',
    operation: 'token.exchange',
    method: 'POST',
    url: options.tokenUri,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    // Safe to repeat: minting a second token costs nothing and invalidates nothing.
    idempotent: true,
  });

  const token = response.body.access_token;
  if (!token) throw new Error('fcm: the token endpoint returned no access_token');
  tokenCache.set(key, { accessToken: token, expiresAt: now + (response.body.expires_in ?? 3600) });
  return token;
}

/** The permanent-rejection status FCM returned, or undefined when a retry could still work. */
const deadTokenStatus = (error: unknown): string | undefined => {
  if (!(error instanceof ProviderHttpError)) return undefined;
  const body = error.body as { error?: { status?: string } } | undefined;
  const status = body?.error?.status;
  return status !== undefined && DEAD_TOKEN_STATUSES.has(status) ? status : undefined;
};

export async function sendPush(logger: Logger, options: SendPushOptions): Promise<SendPushResult> {
  const { baseUrl = FCM_BASE_URL } = options;
  const bearer = await accessToken(logger, options);

  const invalidTokens: string[] = [];
  let providerReference: string | undefined;
  let lastError: Error | undefined;

  for (const token of options.tokens) {
    try {
      const response = await providerRequest<{ name?: string }>(logger, {
        provider: 'fcm',
        operation: 'message.send',
        method: 'POST',
        url: `${baseUrl}/v1/projects/${options.projectId}/messages:send`,
        headers: { authorization: `Bearer ${bearer}` },
        body: {
          message: { token, notification: { title: options.title, body: options.body } },
        },
        idempotent: false,
      });
      providerReference ??= response.body.name;
    } catch (error) {
      if (deadTokenStatus(error) !== undefined) {
        invalidTokens.push(token);
        continue;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  // Nothing got through and the reason was not "this device is gone": let the queue retry.
  if (providerReference === undefined && invalidTokens.length < options.tokens.length && lastError) {
    throw lastError;
  }
  return { providerReference, invalidTokens };
}
