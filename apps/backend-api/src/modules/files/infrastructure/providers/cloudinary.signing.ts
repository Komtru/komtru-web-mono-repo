// Cannibalized from kumtru/backend-apis/src/modules/files/infrastructure/cloudinary.ts (T-001), split
// in two. This half is PURE — a SHA-1 and some string building — which is why it is not named
// `*.client.ts` and why a request handler may call it (design §4.4 names "Cloudinary upload signing"
// as the example of a pure sibling). Everything that reaches the network is in cloudinary.client.ts.
//
// Adapted: every function takes resolved credentials rather than a prefix plus a config singleton.
//
// No SDK. The official package brings a global `cloudinary.config()` object that a five-account
// design would have to fight — serving two accounts in one request means mutating process-wide state
// between them. Hand-rolling the signature keeps every account's credentials a parameter instead.
//
// SECURITY: `api_secret` never leaves this file's call stack. The upload endpoint returns signed
// PARAMETERS to the client, never the secret that produced them.
import { createHash } from 'node:crypto';
import type { CloudinaryCredentials } from '../credentials.js';

export const CLOUDINARY_API_BASE = 'https://api.cloudinary.com/v1_1';
const DELIVERY_BASE = 'https://res.cloudinary.com';

export type CloudinaryParams = Record<string, string | number | boolean>;

export type CloudinaryResourceType = 'image' | 'raw';

/**
 * Cloudinary does not sign these, and including one produces a signature the server computes
 * differently and rejects with a 401 that says nothing about which parameter was wrong.
 */
const UNSIGNED_PARAMS = new Set(['file', 'api_key', 'resource_type', 'cloud_name', 'signature']);

/** Cloudinary's documented scheme: sort by name, join as a query string. */
export const buildStringToSign = (params: CloudinaryParams): string =>
  Object.keys(params)
    .filter((key) => !UNSIGNED_PARAMS.has(key) && params[key] !== undefined && params[key] !== '')
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join('&');

export const signParams = (params: CloudinaryParams, apiSecret: string): string =>
  createHash('sha1')
    .update(buildStringToSign(params) + apiSecret)
    .digest('hex');

const stringify = (params: CloudinaryParams): Record<string, string> =>
  Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));

// ---------------------------------------------------------------------------
// Uploads (M20 §6)
// ---------------------------------------------------------------------------

export interface SignedUpload {
  cloudName: string;
  uploadUrl: string;
  /** Everything the client must POST alongside the file. Contains `api_key`, never `api_secret`. */
  params: Record<string, string>;
}

/**
 * Builds a direct-to-Cloudinary signed upload payload.
 *
 * `type: 'authenticated'` is the whole of D3's first half: the asset is stored in the private,
 * access-controlled delivery mode, so no account ever has a publicly browsable or guessable
 * namespace. The default `upload` type would make every one of these bytes fetchable by anyone who
 * learned the public_id, and the access-control model above it decorative.
 */
export const buildSignedUpload = (input: {
  credentials: CloudinaryCredentials;
  publicId: string;
  resourceType: CloudinaryResourceType;
  /** Cloudinary format names (`jpg`, `png`, `webp`, `pdf`), not MIME types. */
  allowedFormats: readonly string[];
  /** Cloudinary refuses a timestamp more than an hour from its own clock. */
  timestampSeconds?: number;
}): SignedUpload => {
  const { cloudName, apiKey, apiSecret } = input.credentials;
  const timestamp = input.timestampSeconds ?? Math.floor(Date.now() / 1000);

  /**
   * ONLY parameters Cloudinary actually recognises may appear here.
   *
   * This is not a style rule, it is the whole failure mode of signed uploads. Cloudinary rebuilds the
   * string-to-sign from the parameters it knows and silently DROPS the rest, so one invented
   * parameter makes every upload a 401 — and the error names the string it built, never the parameter
   * you added. An earlier version of this code passed `max_bytes`, which is not an upload-API
   * parameter at all; it broke every upload and, worse, was documented as enforcing the size ceiling
   * while enforcing nothing.
   *
   * There is no size ceiling here as a result. Cloudinary's upload API has no parameter for one
   * outside an upload preset; the check lives in the finalize job, after the bytes have landed.
   */
  const signable: CloudinaryParams = {
    public_id: input.publicId,
    timestamp,
    type: 'authenticated',

    /**
     * Format enforcement AT THE DOOR, and the one thing that genuinely is.
     *
     * Cloudinary rejects anything outside this list before storing it, which is what stops an HTML
     * file being uploaded as a KYC_DOCUMENT and becoming stored XSS the moment something renders it
     * inline. The finalize-time content-type check cannot do that — by then the bytes are already
     * stored and already metered against the account's quota.
     */
    allowed_formats: input.allowedFormats.join(','),

    /** Never let Cloudinary infer a public_id from the client's filename; D3 requires ours. */
    use_filename: false,
    unique_filename: false,
    /** A re-used ticket must not silently replace someone else's bytes. */
    overwrite: false,
  };

  return {
    cloudName,
    uploadUrl: `${CLOUDINARY_API_BASE}/${cloudName}/${input.resourceType}/upload`,
    params: { ...stringify(signable), api_key: apiKey, signature: signParams(signable, apiSecret) },
  };
};

// ---------------------------------------------------------------------------
// Retrieval (D3)
// ---------------------------------------------------------------------------

/**
 * A time-limited signed URL for an authenticated asset.
 *
 * Cloudinary offers two mechanisms and they are NOT equivalent:
 *
 *  - a signed DELIVERY url (`res.cloudinary.com/<cloud>/image/authenticated/s--<sig>--/<id>`) is
 *    tamper-proof but has no expiry on any plan below the one that includes token auth;
 *  - the Admin `download` endpoint takes an `expires_at` INSIDE the signature, so the URL genuinely
 *    stops working, and it is available on the free tier.
 *
 * D3 says "short-lived", so the download endpoint is what every restricted class gets. The trade-off
 * is real and worth knowing: it serves as an attachment from `api.cloudinary.com` rather than inline
 * from the CDN, so a client rendering an `<img src>` needs the delivery variant below instead — and
 * accepts that the URL it holds does not expire.
 */
export const buildExpiringDownloadUrl = (input: {
  credentials: CloudinaryCredentials;
  publicId: string;
  resourceType: CloudinaryResourceType;
  ttlSeconds: number;
  nowSeconds?: number;
}): { url: string; expiresAt: Date } => {
  const { cloudName, apiKey, apiSecret } = input.credentials;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expiresAt = now + input.ttlSeconds;

  const signable: CloudinaryParams = {
    expires_at: expiresAt,
    public_id: input.publicId,
    timestamp: now,
    type: 'authenticated',
  };

  const query = new URLSearchParams({
    ...stringify(signable),
    api_key: apiKey,
    signature: signParams(signable, apiSecret),
  });

  return {
    url: `${CLOUDINARY_API_BASE}/${cloudName}/${input.resourceType}/download?${query.toString()}`,
    expiresAt: new Date(expiresAt * 1000),
  };
};

/**
 * A signed INLINE delivery URL, for an `<img src>`.
 *
 * Tamper-proof — the `s--<sig>--` segment covers the public_id, so nobody can walk to another asset —
 * but NOT time-limited on the free tier. Only issued for `PUBLIC` files, where an unexpiring URL is
 * what "public" already means; every restricted class gets the expiring download URL above.
 */
export const buildSignedDeliveryUrl = (input: {
  credentials: CloudinaryCredentials;
  publicId: string;
  resourceType: CloudinaryResourceType;
}): string => {
  const { cloudName, apiSecret } = input.credentials;

  // Cloudinary's URL signature: first 8 base64url characters of sha1(path + api_secret).
  const signature = createHash('sha1')
    .update(`${input.publicId}${apiSecret}`)
    .digest('base64url')
    .slice(0, 8);

  return `${DELIVERY_BASE}/${cloudName}/${input.resourceType}/authenticated/s--${signature}--/${input.publicId}`;
};

// ---------------------------------------------------------------------------
// Destroy (D4) — the signature only; the call itself is in cloudinary.client.ts
// ---------------------------------------------------------------------------

/**
 * The form body for an Admin `destroy`.
 *
 * `type: 'authenticated'` is part of the string-to-sign and not decoration: destroying without it
 * addresses the public namespace, which succeeds and leaves the authenticated asset in place.
 */
export const buildDestroySignature = (input: {
  credentials: CloudinaryCredentials;
  publicId: string;
  timestampSeconds: number;
}): Record<string, string> => {
  const { apiKey, apiSecret } = input.credentials;

  const signable: CloudinaryParams = {
    public_id: input.publicId,
    timestamp: input.timestampSeconds,
    type: 'authenticated',
  };

  return { ...stringify(signable), api_key: apiKey, signature: signParams(signable, apiSecret) };
};
