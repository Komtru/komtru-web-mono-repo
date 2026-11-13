import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import { getViewerFacts } from '../src/index.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the viewer facts endpoint (F-037)', () => {
  it('mirrors the route: a consumer read of /me/viewer', () => {
    expect(getViewerFacts).toMatchObject({ method: 'get', path: '/me/viewer', scope: 'CONSUMER' });
    expect(getViewerFacts.retryable).toBeUndefined();
  });

  it('reads the facts and refuses an answer that is not them', async () => {
    const fetch = vi.fn(() => Promise.resolve(json({ hasSold: true, certifiedMerchant: false })));
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
    await expect(client.call(getViewerFacts, {})).resolves.toEqual({
      hasSold: true,
      certifiedMerchant: false,
    });

    const wrong = createApiClient({
      baseUrl: 'https://api.test/v1',
      fetch: vi.fn(() => Promise.resolve(json({ hasSold: 'yes' }))),
    });
    await expect(wrong.call(getViewerFacts, {})).rejects.toThrow();
  });
});
