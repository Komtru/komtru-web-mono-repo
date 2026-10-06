import { readAppConfig, SESSION_SECRET_ENV } from '@komtru/app-kit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appSpec } from '../src/app-config.js';

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

  it('declares the session secret the middleware needs', () => {
    expect(Object.keys(envExample())).toContain(SESSION_SECRET_ENV);
  });
});
