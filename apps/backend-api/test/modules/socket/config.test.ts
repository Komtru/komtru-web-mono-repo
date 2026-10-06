// T-027's configuration. The socket server is the one listener whose CORS allowlist being empty
// fails silently in the browser and nowhere else, so the fallback to ALLOWED_ORIGINS is pinned here.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';

const base = { POSTGRES_URL: 'postgresql://x@localhost/x', REDIS_URL: 'redis://localhost:6379' };

describe('socket configuration', () => {
  it('defaults to enabled, the conventional path and no origins', () => {
    expect(loadConfig(base).socket).toEqual({
      enabled: true,
      path: '/socket.io',
      corsOrigins: [],
      revalidateIntervalSeconds: 30,
      credentialGraceSeconds: 60,
    });
  });

  it('falls back to ALLOWED_ORIGINS when SOCKET_CORS_ORIGINS is unset', () => {
    const config = loadConfig({ ...base, ALLOWED_ORIGINS: 'https://a.test, https://b.test' });
    expect(config.socket.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
  });

  it('prefers SOCKET_CORS_ORIGINS over ALLOWED_ORIGINS', () => {
    const config = loadConfig({
      ...base,
      ALLOWED_ORIGINS: 'https://a.test',
      SOCKET_CORS_ORIGINS: 'https://sockets.test',
    });
    expect(config.socket.corsOrigins).toEqual(['https://sockets.test']);
  });

  it('rejects a revalidation interval outside 5-300 seconds', () => {
    expect(() => loadConfig({ ...base, SOCKET_REVALIDATE_INTERVAL_SECONDS: '600' })).toThrow(
      /SOCKET_REVALIDATE_INTERVAL_SECONDS/,
    );
  });

  it('rejects a path that is not rooted', () => {
    expect(() => loadConfig({ ...base, SOCKET_PATH: 'socket.io' })).toThrow(/SOCKET_PATH/);
  });

  it('takes SOCKET_ENABLED=false', () => {
    expect(loadConfig({ ...base, SOCKET_ENABLED: 'false' }).socket.enabled).toBe(false);
  });
});
