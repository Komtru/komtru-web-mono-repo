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

  it('covers the weights ui-kit loads through next/font', () => {
    const mono = FONT_FACES.filter((face) => face.family === 'IBM Plex Mono').map((face) => face.weight);
    expect(mono).toEqual(['400', '500', '600']);
    expect(FONT_FACES.find((face) => face.family === 'Inter')?.weight).toBe('100 900');
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
