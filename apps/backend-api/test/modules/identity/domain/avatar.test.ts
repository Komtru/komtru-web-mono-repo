// T-041: the pure rules behind setting an avatar and importing a provider's picture.
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_IMAGE_MAX_BYTES,
  checkAvatarFile,
  checkProviderImage,
  checkProviderImageUrl,
  type AvatarFileView,
} from '../../../../src/modules/identity/domain/avatar.js';

const USER = '0190b0a0-0000-7000-8000-000000000001';
const OTHER = '0190b0a0-0000-7000-8000-000000000002';
const file = (over: Partial<AvatarFileView> = {}): AvatarFileView => ({
  id: '0190b0a0-0000-7000-8000-0000000000f1',
  category: 'PROFILE_PHOTO',
  uploaderUserId: USER,
  uploadState: 'READY',
  status: 'ACTIVE',
  ...over,
});

describe('checkAvatarFile', () => {
  it('accepts the caller’s own finished, active profile photo', () => {
    expect(checkAvatarFile(file(), USER)).toEqual({ ok: true });
  });

  it('treats a missing file and someone else’s file identically', () => {
    expect(checkAvatarFile(undefined, USER)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(checkAvatarFile(file({ uploaderUserId: OTHER }), USER)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('refuses another category, an unfinished upload and a tombstoned file', () => {
    expect(checkAvatarFile(file({ category: 'KYC_DOCUMENT' }), USER)).toEqual({
      ok: false,
      reason: 'WRONG_CATEGORY',
    });
    expect(checkAvatarFile(file({ uploadState: 'RECONCILING' }), USER)).toEqual({
      ok: false,
      reason: 'NOT_READY',
    });
    expect(checkAvatarFile(file({ status: 'TOMBSTONED' }), USER)).toEqual({
      ok: false,
      reason: 'TOMBSTONED',
    });
  });

  it('reports a file uploaded by someone else as not found even when it is the wrong category', () => {
    expect(checkAvatarFile(file({ uploaderUserId: OTHER, category: 'KYC_DOCUMENT' }), USER)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });
});

describe('checkProviderImageUrl', () => {
  it('accepts a plain https url', () => {
    const result = checkProviderImageUrl('https://lh3.googleusercontent.com/a/abc=s96-c');
    expect(result.ok).toBe(true);
  });

  it.each([
    ['http://example.com/a.jpg', 'plain http'],
    ['https://user:pw@example.com/a.jpg', 'credentials in the url'],
    ['https://localhost/a.jpg', 'localhost'],
    ['https://127.0.0.1/a.jpg', 'loopback'],
    ['https://10.0.0.5/a.jpg', 'private range'],
    ['https://192.168.1.1/a.jpg', 'private range'],
    ['https://172.16.0.1/a.jpg', 'private range'],
    ['https://169.254.169.254/latest/meta-data', 'link-local metadata address'],
    ['https://[::1]/a.jpg', 'ipv6 loopback'],
    ['https://2130706433/a.jpg', 'decimal spelling of 127.0.0.1'],
    ['https://0x7f.1/a.jpg', 'hex spelling of 127.0.0.1'],
    ['https://db.internal/a.jpg', 'internal suffix'],
    ['https://example.com:8443/a.jpg', 'non-standard port'],
    ['file:///etc/passwd', 'non-http scheme'],
    ['not a url', 'garbage'],
  ])('refuses %s (%s)', (url) => {
    expect(checkProviderImageUrl(url).ok).toBe(false);
  });
});

const bytes = (head: number[], length = 32): Uint8Array => {
  const out = new Uint8Array(length);
  out.set(head);
  return out;
};
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

describe('checkProviderImage', () => {
  it('names the type from the magic bytes', () => {
    expect(checkProviderImage(bytes(JPEG))).toEqual({ ok: true, contentType: 'image/jpeg' });
    expect(checkProviderImage(bytes(PNG))).toEqual({ ok: true, contentType: 'image/png' });
    expect(checkProviderImage(bytes(WEBP))).toEqual({ ok: true, contentType: 'image/webp' });
  });

  it('refuses SVG, HTML, GIF and RIFF that is not WebP, whatever a header said', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(checkProviderImage(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).ok).toBe(false);
    expect(checkProviderImage(text('<html><script>alert(1)</script></html>')).ok).toBe(false);
    expect(checkProviderImage(text('GIF89a......')).ok).toBe(false);
    expect(checkProviderImage(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])).ok).toBe(
      false,
    );
  });

  it('refuses an empty body and one over the cap', () => {
    expect(checkProviderImage(new Uint8Array(0)).ok).toBe(false);
    expect(checkProviderImage(bytes(JPEG, PROVIDER_IMAGE_MAX_BYTES)).ok).toBe(true);
    expect(checkProviderImage(bytes(JPEG, PROVIDER_IMAGE_MAX_BYTES + 1)).ok).toBe(false);
  });
});
