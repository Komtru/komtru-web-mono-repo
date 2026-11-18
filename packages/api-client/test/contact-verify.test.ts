// F-081's contracts: the four verification routes and the `contacts` block they put on `/me`.
import { describe, expect, it } from 'vitest';
import {
  confirmEmailVerification,
  confirmPhoneVerification,
  getMe,
  startEmailVerification,
  startPhoneVerification,
} from '../src/account.js';

const ID = '0190b0a0-0000-7000-8000-00000000000a';
const WHEN = '2026-11-18T18:00:00.000Z';

const channel = (over: object = {}) => ({ present: true, masked: 'j•••@x.test', verified: true, ...over });

describe('contact verification contracts (F-081)', () => {
  it('names the four routes, none of them retried', () => {
    for (const [endpoint, path] of [
      [startEmailVerification, '/me/email/verify/start'],
      [confirmEmailVerification, '/me/email/verify/confirm'],
      [startPhoneVerification, '/me/phone/verify/start'],
      [confirmPhoneVerification, '/me/phone/verify/confirm'],
    ] as const) {
      expect(endpoint).toMatchObject({ method: 'post', path, scope: 'CONSUMER', retryable: false });
    }
  });

  it('lets a start omit the address, because the account may already hold one', () => {
    expect(startEmailVerification.schema.body?.safeParse({}).success).toBe(true);
    expect(startEmailVerification.schema.body?.safeParse({ address: 'me@x.test' }).success).toBe(true);
  });

  it('keeps the phone bound tighter than the email one', () => {
    expect(startPhoneVerification.schema.body?.safeParse({ address: 'x'.repeat(40) }).success).toBe(false);
    expect(
      startEmailVerification.schema.body?.safeParse({ address: `${'x'.repeat(40)}@x.test` }).success,
    ).toBe(true);
  });

  it('parses a start response, including a send that did not go out', () => {
    const parsed = startEmailVerification.schema.response.parse({
      challengeId: ID,
      maskedDestination: 'j•••@x.test',
      expiresAt: WHEN,
      delivered: false,
    });
    expect(parsed.delivered).toBe(false);
  });

  it('parses a confirm response carrying the new level', () => {
    const parsed = confirmPhoneVerification.schema.response.parse({
      status: 'VERIFIED',
      verificationLevel: 'CONTACT_VERIFIED',
      maskedDestination: '+23480•••4471',
    });
    expect(parsed.verificationLevel).toBe('CONTACT_VERIFIED');
  });

  it('carries each contact channel on /me, including one the account does not have', () => {
    const parsed = getMe.schema.response.parse({
      id: ID,
      publicId: 'KMT-1',
      username: null,
      verificationLevel: 'UNVERIFIED',
      contacts: {
        email: channel({ verified: false }),
        phone: { present: false, masked: null, verified: false },
      },
      account: {
        status: 'ACTIVE',
        since: WHEN,
        abilities: { login: true, browse: true, buy: true, sell: true, withdraw: false },
        openTrades: false,
        canClose: true,
        supportReference: 'KMT-1',
        noticeKey: null,
      },
    });
    expect(parsed.contacts.phone.present).toBe(false);
    expect(parsed.contacts.email.verified).toBe(false);
  });
});
