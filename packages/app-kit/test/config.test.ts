import { describe, expect, it } from 'vitest';
import { readAppConfig, type AppSpec } from '../src/config.js';

const env = {
  NEXT_PUBLIC_KOMTRU_APP_URL: 'https://app.komtru.com',
  NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
  NEXT_PUBLIC_KOMTRU_SOCKET_URL: 'https://api.komtru.com',
};
const spec: AppSpec = { appName: 'web-app-ui', scope: 'CONSUMER' };

describe('readAppConfig', () => {
  it('reads the public environment and applies the path defaults', () => {
    expect(readAppConfig(spec, env)).toEqual({
      appName: 'web-app-ui',
      scope: 'CONSUMER',
      appUrl: 'https://app.komtru.com',
      apiUrl: 'https://api.komtru.com/v1',
      socketUrl: 'https://api.komtru.com',
      sentryDsn: undefined,
      signInPath: '/sign-in',
      homePath: '/',
      elsewhereUrl: undefined,
    });
  });

  it('names the variable that is missing', () => {
    expect(() => readAppConfig(spec, { ...env, NEXT_PUBLIC_KOMTRU_API_URL: undefined })).toThrow(
      /NEXT_PUBLIC_KOMTRU_API_URL/,
    );
  });

  it('rejects a URL that is not one', () => {
    expect(() => readAppConfig(spec, { ...env, NEXT_PUBLIC_KOMTRU_APP_URL: 'app.komtru.com' })).toThrow(
      /NEXT_PUBLIC_KOMTRU_APP_URL/,
    );
  });

  it('treats an empty optional variable as absent, because that is what .env.example ships', () => {
    expect(readAppConfig(spec, { ...env, NEXT_PUBLIC_SENTRY_DSN: '' }).sentryDsn).toBeUndefined();
    expect(readAppConfig(spec, { ...env, NEXT_PUBLIC_KOMTRU_SOCKET_URL: '' }).socketUrl).toBeUndefined();
  });

  it('reads the elsewhere URL from the variable the spec names', () => {
    const parkSpec: AppSpec = {
      appName: 'park-agent-app',
      scope: 'LOGISTICS',
      elsewhereUrlEnv: 'NEXT_PUBLIC_KOMTRU_LOGISTICS_URL',
    };
    expect(
      readAppConfig(parkSpec, { ...env, NEXT_PUBLIC_KOMTRU_LOGISTICS_URL: 'https://logistics.komtru.com' })
        .elsewhereUrl,
    ).toBe('https://logistics.komtru.com');
  });

  it('trims a trailing slash off the API base so a path join never doubles it', () => {
    expect(
      readAppConfig(spec, { ...env, NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1/' }).apiUrl,
    ).toBe('https://api.komtru.com/v1');
  });

  it('takes the sign-in and home paths from the spec when it states them', () => {
    const staff: AppSpec = {
      appName: 'operations-app',
      scope: 'STAFF',
      signInPath: '/staff/sign-in',
      homePath: '/queue',
    };
    expect(readAppConfig(staff, env)).toMatchObject({
      scope: 'STAFF',
      signInPath: '/staff/sign-in',
      homePath: '/queue',
    });
  });
});
