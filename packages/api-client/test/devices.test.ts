import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import { registerDevice } from '../src/devices.js';

const DEVICE = {
  id: '0190b0a0-0000-7000-8000-000000000001',
  fingerprintHint: 'abc123',
  platform: 'WEB',
  osVersion: null,
  appVersion: null,
  model: null,
  status: 'ACTIVE',
  trustedAt: null,
  firstSeenAt: '2026-11-11T10:00:00.000Z',
  lastSeenAt: '2026-11-11T10:00:00.000Z',
  hasPushToken: true,
};

describe('registerDevice', () => {
  it('is a consumer-scoped, unkeyed upsert', () => {
    expect(registerDevice).toMatchObject({
      method: 'post',
      path: '/me/devices',
      scope: 'CONSUMER',
      retryable: false,
    });
  });

  it('sends the fingerprint, platform and push token and parses the device back', async () => {
    const bodies: string[] = [];
    const fetch = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return Promise.resolve(
        new Response(JSON.stringify(DEVICE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });

    const device = await client.call(registerDevice, {
      body: { deviceFingerprint: 'fp-1', platform: 'WEB', pushToken: 'tok' },
    });

    expect(device.hasPushToken).toBe(true);
    expect(JSON.parse(bodies[0] ?? '{}')).toEqual({
      deviceFingerprint: 'fp-1',
      platform: 'WEB',
      pushToken: 'tok',
    });
  });
});
