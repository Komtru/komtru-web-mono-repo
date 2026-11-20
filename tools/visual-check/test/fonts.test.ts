import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseRootTokens } from '@komtru/ui-kit/extract-tokens';

import { FONT_FACES, fontStylesheet } from '../src/fonts.ts';
import { REFERENCE_HTML_PATH } from '../src/screen-index.ts';

const css = fontStylesheet();

describe('the injected font stylesheet', () => {
  it('declares exactly the families the reference names', () => {
    const tokens = parseRootTokens(readFileSync(REFERENCE_HTML_PATH, 'utf8'));
    const named = ['--font-display', '--font-body', '--font-mono'].map((token) =>
      (tokens.get(token) ?? '').split(',')[0]?.replaceAll("'", ''),
    );
    expect([...new Set(FONT_FACES.map((face) => face.family))]).toEqual(named);
    for (const family of named) expect(css).toContain(`font-family: '${family}';`);
  });

  it('loads the very files ui-kit hands to next/font, at the same weights', () => {
    const source = readFileSync(new URL('../../../packages/ui-kit/src/fonts.ts', import.meta.url), 'utf8');
    // Every face here is one `{ path, weight }` entry there, so the two sides cannot drift apart.
    for (const face of FONT_FACES) {
      const name = face.file.split('/').at(-1)!;
      expect(source, face.family).toContain(`path: '../fonts/${name}', weight: '${face.weight}'`);
    }
    expect(FONT_FACES.map((face) => face.weight)).toEqual(['400 700', '100 900', '400', '500', '600']);
  });

  it('inlines the files so nothing is fetched at screenshot time', () => {
    expect(css).toMatch(/src: url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\) format\('woff2'\)/);
    expect(css).not.toMatch(/https?:/);
  });

  it('blocks paint until the faces load', () => {
    expect(css.match(/font-display: block;/g)).toHaveLength(FONT_FACES.length);
  });

  it('stops animation, transition and the caret', () => {
    expect(css).toContain('animation: none !important;');
    expect(css).toContain('transition: none !important;');
    expect(css).toContain('caret-color: transparent !important;');
  });
});
