import { readAppConfig, SESSION_SECRET_ENV } from '@komtru/app-kit';
import { PARK_URL_ENV, PASSPORT_URL_ENV, readWebAppConfig } from '../src/app-config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appSpec } from '../src/app-config';
import { ROOT_DESTINATION } from '../src/shell/nav';

/** `.env.example` is the documented environment; a config that cannot be built from it is wrong. */
const envExample = (): Record<string, string> => {
  const text = readFileSync(fileURLToPath(new URL('../.env.example', import.meta.url)), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=([^#]*)/.exec(line.trim());
    if (match) env[match[1]!] = match[2]!.trim();
  }
  return env;
};

describe('@komtru/web-app-ui app spec', () => {
  it('names the session scope this app requires', () => {
    expect(appSpec.scope).toBe('CONSUMER');
  });

  it("builds a config from this app's own .env.example", () => {
    expect(readAppConfig(appSpec, envExample())).toMatchObject({
      appName: 'web-app-ui',
      scope: 'CONSUMER',
      appUrl: 'http://localhost:3001',
    });
  });

  it('opens on Home, where the root sends everyone, not the retired Trades-as-home', () => {
    expect(appSpec.homePath).toBe(ROOT_DESTINATION);
    expect(appSpec.homePath).toBe('/');
  });

  it('declares the session secret the middleware needs', () => {
    expect(Object.keys(envExample())).toContain(SESSION_SECRET_ENV);
  });
});

describe('the two URLs only this app has', () => {
  it('builds both from the documented environment', () => {
    expect(readWebAppConfig(envExample())).toMatchObject({
      passportUrl: 'http://localhost:3001/passport',
      parkUrl: 'http://localhost:3004',
    });
  });

  it('names every missing variable at once, not one restart at a time', () => {
    const env = { ...envExample(), [PASSPORT_URL_ENV]: '', [PARK_URL_ENV]: 'not-a-url' };
    expect(() => readWebAppConfig(env)).toThrow(
      `web-app-ui: ${PASSPORT_URL_ENV} is missing; ${PARK_URL_ENV} is not a valid URL`,
    );
  });

  it('drops a trailing slash, so a built link never doubles one', () => {
    const env = { ...envExample(), [PARK_URL_ENV]: 'https://park.komtru.com/' };
    expect(readWebAppConfig(env).parkUrl).toBe('https://park.komtru.com');
  });
});
