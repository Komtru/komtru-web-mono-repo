import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
};

describe('logger packaging', () => {
  // The pretty format is the default whenever NODE_ENV is not production, so a deploy that forgets
  // NODE_ENV must still be able to load the transport.
  it('ships the pretty transport as a runtime dependency', () => {
    expect(manifest.dependencies).toHaveProperty('pino-pretty');
  });
});
