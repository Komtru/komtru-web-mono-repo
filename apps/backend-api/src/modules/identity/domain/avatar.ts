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

/**
 * An https URL on a named public host. Literal IPs are refused outright (a provider's picture lives
 * on a named CDN host, and the URL parser has already normalised decimal, hex and octal spellings to
 * dotted form), as are the usual internal names. This is a cheap first filter, NOT the SSRF defence:
 * a hostname that RESOLVES to a private address cannot be caught here, which is why the `fetchImage`
 * port carries its own contract (see `AvatarPorts.fetchImage`).
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
  if (/^\d+(\.\d+){3}$/.test(host)) {
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

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

/** What the bytes ARE, by signature. A header is the provider's claim; the bytes are the evidence. */
export const sniffImageType = (bytes: Uint8Array): ProviderImageType | undefined => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return undefined;
};

/**
 * PROFILE_PHOTO is PUBLIC, so whatever is stored is served to anyone: the type comes from magic bytes
 * and the declared content type is ignored entirely (an SVG or HTML body labelled image/png is
 * refused, and so is a PNG labelled text/html: the stored type is the sniffed one either way).
 */
export const checkProviderImage = (bytes: Uint8Array): ProviderImageCheck => {
  if (bytes.byteLength <= 0) return { ok: false, reason: 'empty image' };
  if (bytes.byteLength > PROVIDER_IMAGE_MAX_BYTES) return { ok: false, reason: 'image too large' };
  const contentType = sniffImageType(bytes);
  if (!contentType) return { ok: false, reason: 'not a JPEG, PNG or WebP image' };
  return { ok: true, contentType };
};
