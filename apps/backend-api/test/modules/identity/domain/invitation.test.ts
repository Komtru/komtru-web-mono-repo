import { describe, expect, it } from 'vitest';
import {
  INVITATION_DESTINATION_DOMAIN,
  INVITATION_TTL_DAYS,
  invitationChannelsFor,
  invitationDestinationHash,
  invitationExpiry,
  invitationTokenHash,
  issueInvitationToken,
} from '../../../../src/modules/identity/domain/invitation.js';
import { OTP_DESTINATION_DOMAIN } from '../../../../src/modules/identity/domain/otp/challenge.js';
import { createHmacHasher, sha256 } from '../../../../src/platform/crypto/hmac.js';

describe('party invitation tokens (M1 §8.5)', () => {
  it('mints 256 bits of url-safe randomness that never repeats', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => issueInvitationToken().token));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes the token unkeyed, because it is already uniform randomness', () => {
    const { token, tokenHash } = issueInvitationToken();
    expect(invitationTokenHash(token)).toEqual(tokenHash);
    expect(tokenHash).toEqual(sha256(token));
  });

  it('expires fourteen days out, as §8.5 step 7 requires', () => {
    expect(INVITATION_TTL_DAYS).toBe(14);
    expect(invitationExpiry(new Date('2026-10-06T00:00:00Z')).toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});

describe('party invitation destinations (M1 §S9, §S12)', () => {
  const hasher = createHmacHasher('a-pepper-for-tests-0123456789abc');

  it('separates its HMAC domain from the OTP one', () => {
    // A leaked invitation row must not confirm a guess against otp_challenges, and the other way
    // round. Same pepper, same value, different digest.
    expect(invitationDestinationHash(hasher, 'jane@gmail.com')).not.toEqual(
      hasher.hmac(OTP_DESTINATION_DOMAIN, 'jane@gmail.com'),
    );
    expect(INVITATION_DESTINATION_DOMAIN).not.toBe(OTP_DESTINATION_DOMAIN);
  });

  it('is deterministic, so a verification can find the invitation it belongs to', () => {
    expect(invitationDestinationHash(hasher, '+2348023415567')).toEqual(
      invitationDestinationHash(hasher, '+2348023415567'),
    );
  });

  it('stores a phone invitation under every channel it could be sent on', () => {
    expect(invitationChannelsFor('PHONE')).toEqual(['SMS', 'WHATSAPP', 'VOICE']);
    expect(invitationChannelsFor('EMAIL')).toEqual(['EMAIL']);
  });
});
