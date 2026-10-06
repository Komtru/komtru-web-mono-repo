// M1 §10.5's device and session lines, as declarations. T-031 left `GET /me/sessions` and
// `DELETE /me/sessions/{id}` belonging to no ticket; they sit on the same screen as the device list,
// so T-036 takes them.
import { describe, expect, it } from 'vitest';
import { deviceRoutes } from '../../../../src/modules/identity/http/routes/device.routes.js';
import type { DeviceControllerDeps } from '../../../../src/modules/identity/http/controllers/device.controller.js';
import type { Db } from '../../../../src/db/index.js';
import { assertRouteInvariants, type HttpMethod } from '../../../../src/platform/http/route.js';
import { testLogger } from '../support.js';

const deps: DeviceControllerDeps = { db: null as unknown as Db, logger: testLogger };
const routes = deviceRoutes(deps);

const find = (method: HttpMethod, path: string) => {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
};

describe('device and session routes', () => {
  it('declares the six §10.5 endpoints', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'POST /me/devices',
      'GET /me/devices',
      'DELETE /me/devices/:id',
      'POST /me/devices/:id/trust',
      'GET /me/sessions',
      'DELETE /me/sessions/:id',
    ]);
  });

  it('passes the platform route invariants', () => {
    expect(() => assertRouteInvariants(routes)).not.toThrow();
  });

  it('needs a consumer session everywhere — none of this is public', () => {
    for (const route of routes) expect(route.scope).toBe('CONSUMER');
  });

  it('paginates both lists, which assertRouteInvariants would otherwise refuse', () => {
    expect(find('get', '/me/devices').paginated).toBe('page');
    expect(find('get', '/me/sessions').paginated).toBe('page');
  });

  it('declares every mutating route non-retryable', () => {
    for (const route of routes.filter((r) => r.method !== 'get')) {
      expect(route.retryable).toBe(false);
    }
  });

  describe('POST /me/devices body', () => {
    const body = () => find('post', '/me/devices').schema.body;

    it('is strict, so a field a client invents is a 422 rather than silence', () => {
      expect(body()?.safeParse({ deviceFingerprint: 'abc', extra: 1 }).success).toBe(false);
    });

    it('takes a fingerprint, a platform and a push token', () => {
      const parsed = body()?.safeParse({
        deviceFingerprint: 'abc123',
        platform: 'ANDROID',
        osVersion: '15',
        appVersion: '1.2.3',
        model: 'Pixel 8',
        pushToken: 'fcm-token',
      });
      expect(parsed?.success).toBe(true);
    });

    it('bounds the push token, which lands in a text column from an unauthenticated client app', () => {
      expect(body()?.safeParse({ deviceFingerprint: 'a', pushToken: 'x'.repeat(4097) }).success).toBe(false);
    });

    it('refuses an empty fingerprint rather than writing a row keyed on nothing', () => {
      expect(body()?.safeParse({ deviceFingerprint: '' }).success).toBe(false);
      expect(body()?.safeParse({ deviceFingerprint: '   ' }).success).toBe(false);
    });
  });

  it('takes the device and session ids as uuids, so a bad one never reaches a ::uuid cast', () => {
    expect(find('delete', '/me/devices/:id').schema.params?.safeParse({ id: 'nope' }).success).toBe(false);
    expect(find('delete', '/me/sessions/:id').schema.params?.safeParse({ id: 'nope' }).success).toBe(false);
  });
});
