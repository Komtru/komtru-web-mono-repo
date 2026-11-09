import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  acceptTerms,
  changePassword,
  forgotPassword,
  getMyTerms,
  getPublishedTerms,
  register,
  resendOtp,
  resetPassword,
} from '../src/entry.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the entry endpoints', () => {
  it('open everything before a session to anyone, and keep the terms routes signed in', () => {
    for (const endpoint of [getPublishedTerms, register, resendOtp, forgotPassword, resetPassword]) {
      expect(endpoint.scope).toBe('PUBLIC');
    }
    for (const endpoint of [changePassword, getMyTerms, acceptTerms]) expect(endpoint.scope).toBe('CONSUMER');
  });

  it('never retry a call whose answer carries a live challenge or changes a credential', () => {
    for (const endpoint of [
      register,
      resendOtp,
      forgotPassword,
      resetPassword,
      changePassword,
      acceptTerms,
    ]) {
      expect(endpoint).toMatchObject({ method: 'post', retryable: false });
    }
  });

  it('register on the phone path with the versions the person was shown', async () => {
    const urls: string[] = [];
    const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
        channel: 'PHONE',
        phone: '08023415567',
        fullName: 'Ada Obi',
        acceptedTermsVersion: '2026-08-01',
        acceptedPrivacyVersion: '2026-08-01',
      });
      return Promise.resolve(
        json(
          {
            userId: '0190b0a0-0000-7000-8000-000000000001',
            publicId: 'u_1',
            status: 'PENDING',
            challengeId: '0190b0a0-0000-7000-8000-000000000002',
            nextStep: 'VERIFY_PHONE',
            expiresAt: 4_000_000_000_000,
            maskedDestination: '+23480•••5567',
            delivered: true,
          },
          201,
        ),
      );
    });
    const client = createApiClient({ baseUrl: 'https://api.komtru.com/v1', fetch });
    const result = await client.call(register, {
      body: {
        channel: 'PHONE',
        phone: '08023415567',
        fullName: 'Ada Obi',
        acceptedTermsVersion: '2026-08-01',
        acceptedPrivacyVersion: '2026-08-01',
      },
    });
    expect(result).toMatchObject({ nextStep: 'VERIFY_PHONE', maskedDestination: '+23480•••5567' });
    expect(urls[0]).toBe('https://api.komtru.com/v1/auth/register');
  });
});
