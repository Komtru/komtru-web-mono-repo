// T-041. The pure rules behind an avatar (M1 D7). No database and no network, so every rule here is
// testable without either.

/** The slice of a files-module record the avatar rules need, handed in by a port. */
export interface AvatarFileView {
  id: string;
  category: string;
  uploaderUserId: string;
  uploadState: string;
  status: string;
}

export type AvatarFileRefusal = 'NOT_FOUND' | 'WRONG_CATEGORY' | 'NOT_READY' | 'TOMBSTONED';

export type AvatarFileCheck = { ok: true } | { ok: false; reason: AvatarFileRefusal };

/**
 * May this file become this user's avatar?
 *
 * Ownership is checked FIRST and answers NOT_FOUND, the same as a file that does not exist: a caller
 * must not learn that a uuid they guessed is somebody else's KYC document (the files module keeps the
 * same rule on retrieval). Only once the file is known to be theirs do the specific reasons appear.
 */
export const checkAvatarFile = (file: AvatarFileView | undefined, userId: string): AvatarFileCheck => {
  if (!file || file.uploaderUserId !== userId) return { ok: false, reason: 'NOT_FOUND' };
  if (file.category !== 'PROFILE_PHOTO') return { ok: false, reason: 'WRONG_CATEGORY' };
  if (file.status === 'TOMBSTONED') return { ok: false, reason: 'TOMBSTONED' };
  if (file.uploadState !== 'READY') return { ok: false, reason: 'NOT_READY' };
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Provider avatars (M1 section 7.4): fetched server-side, so the URL is untrusted input to an
// outbound request. These checks are the SSRF guard.
// ---------------------------------------------------------------------------

export const PROVIDER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROVIDER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProviderImageType = (typeof PROVIDER_IMAGE_TYPES)[number];

export type ProviderUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^(22[4-9]|2[3-5]\d)\./,
];

/**
 * An https URL on a public host. Literal IPs are refused outright (a provider's picture lives on a
 * named CDN host), as are the usual internal names. A hostname that RESOLVES to a private address
 * cannot be caught here: the `fetchImage` port must also refuse private resolutions and redirects.
 */
export const checkProviderImageUrl = (raw: string): ProviderUrlCheck => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https is accepted' };
  if (url.username || url.password) return { ok: false, reason: 'credentials in the url' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'non-standard port' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || host.includes(':')) return { ok: false, reason: 'ip literal' };
  if (/^\d+(\.\d+){3}$/.test(host) || PRIVATE_V4.some((re) => re.test(host))) {
    return { ok: false, reason: 'ip literal' };
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.')
  ) {
    return { ok: false, reason: 'internal host' };
  }
  return { ok: true, url };
};

export type ProviderImageCheck = { ok: true; contentType: ProviderImageType } | { ok: false; reason: string };

export const checkProviderImage = (input: {
  contentType: string;
  byteLength: number;
}): ProviderImageCheck => {
  const contentType = (input.contentType.split(';')[0] ?? '').trim().toLowerCase();
  const accepted = PROVIDER_IMAGE_TYPES.find((type) => type === contentType);
  if (!accepted) return { ok: false, reason: `${contentType || 'unknown'} is not an accepted image type` };
  if (input.byteLength <= 0) return { ok: false, reason: 'empty image' };
  if (input.byteLength > PROVIDER_IMAGE_MAX_BYTES) return { ok: false, reason: 'image too large' };
  return { ok: true, contentType: accepted };
};
