import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as uiKit from '../src/index.js';

describe('@komtru/ui-kit', () => {
  it('exposes the tokens and the brand components', () => {
    expect(Object.keys(uiKit).sort()).toEqual(['KOMTRU_TOKENS', 'KomtruLogo', 'KomtruMark', 'cssVar']);
  });
});

describe('the published sources', () => {
  // The library preset's NodeNext resolution would have enforced this; ui-kit had to move to
  // bundler resolution for `next/font/google`, so the convention needs its own guard.
  it('give every relative import a .js extension, because dist is consumed as Node ESM', () => {
    const sources = globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() });
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources.flatMap((file) => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      return [...source.matchAll(/from '(\.[^']*)'/g)]
        .filter((match) => !match[1]?.endsWith('.js'))
        .map((match) => `${file}: ${match[1]}`);
    });
    expect(offenders).toEqual([]);
  });
});
