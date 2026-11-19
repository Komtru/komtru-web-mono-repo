// The Youverify adapter against a stubbed transport: what it sends, what it returns, and — the part
// that matters most — which failures it refuses to turn into a verdict about a person.
//
// A 402 means the Youverify balance is empty and a 429 means that NIN was tried again within ten
// minutes. Neither says anything about whether the person is who they claim. Both must leave the
// request open (the job rethrows, BullMQ retries, the sweep is the floor) rather than resolving to
// FAILED, which would show the user a rejection they did not earn.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderHttpError } from '../../../src/platform/providers/http.js';
import { createYouverifyClient } from '../../../src/modules/trust/infrastructure/providers/youverify.client.js';
import { createLogger } from '../../../src/platform/logger.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);
const credentials = {
  secretToken: 'secret-token',
  publicMerchantKey: 'mk',
  webhookSecret: 'whs',
  baseUrl: 'https://api.sandbox.youverify.test',
};
const claim = { identifier: '11111111111', firstName: 'Sarah', lastName: 'Doe' };

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function stubFetch(status: number, payload: unknown): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    });
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  return sent;
}

const found = {
  success: true,
  data: {
    id: 'yv-record-1',
    status: 'found',
    dataValidation: true,
    allValidationPassed: true,
    validations: {
      data: {
        firstName: { validated: true, value: 'Sarah' },
        lastName: { validated: true, value: 'Doe' },
      },
    },
  },
};

afterEach(() => void vi.unstubAllGlobals());

describe('createYouverifyClient — NIN and BVN', () => {
  it('sends the token header and the claim to the NIN endpoint', async () => {
    const sent = stubFetch(200, found);
    await createYouverifyClient(credentials, logger).verifyNin(claim);
    expect(sent[0]?.url).toBe('https://api.sandbox.youverify.test/v2/api/identity/ng/nin');
    expect(sent[0]?.headers.token).toBe('secret-token');
    expect(sent[0]?.body).toMatchObject({
      id: '11111111111',
      isSubjectConsent: true,
      validations: { data: { firstName: 'Sarah', lastName: 'Doe' } },
    });
  });

  it('returns the mapped verdict', async () => {
    stubFetch(200, found);
    const result = await createYouverifyClient(credentials, logger).verifyNin(claim);
    expect(result.verdict).toBe('PASSED');
    expect(result.providerReference).toBe('yv-record-1');
  });

  it('uses the BVN endpoint for a BVN', async () => {
    const sent = stubFetch(200, found);
    await createYouverifyClient(credentials, logger).verifyBvn(claim);
    expect(sent[0]?.url).toBe('https://api.sandbox.youverify.test/v2/api/identity/ng/bvn');
  });

  it('stamps every row it produces as YOUVERIFY', () => {
    expect(createYouverifyClient(credentials, logger).provider).toBe('YOUVERIFY');
  });
});

describe('operational failures are not verdicts about a person', () => {
  it('throws on 402 Insufficient fund rather than rejecting the user', async () => {
    stubFetch(402, { success: false, statusCode: 402, message: 'Insufficient fund' });
    const call = createYouverifyClient(credentials, logger).verifyNin(claim);
    await expect(call).rejects.toBeInstanceOf(ProviderHttpError);
    await expect(call).rejects.toMatchObject({ status: 402 });
  });

  it('throws on the per-ID 429 rather than rejecting the user', async () => {
    stubFetch(429, {
      success: false,
      statusCode: 429,
      message: 'Too many requests for this ID number in a short time. Please try again after 10mins.',
    });
    await expect(createYouverifyClient(credentials, logger).verifyNin(claim)).rejects.toBeInstanceOf(
      ProviderHttpError,
    );
  });

  it('throws on 401 rather than reporting the person could not be found', async () => {
    stubFetch(401, { success: false, statusCode: 401, message: 'Unauthorized' });
    await expect(createYouverifyClient(credentials, logger).verifyNin(claim)).rejects.toThrow();
  });
});
