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
    const weights = (family: string) =>
      FONT_FACES.filter((face) => face.family === family).map((face) => face.weight);
    const source = readFileSync(new URL('../../../packages/ui-kit/src/fonts.ts', import.meta.url), 'utf8');

    // Discrete weights on both sides, so a variable instance never stands in for a static cut.
    expect(weights('Space Grotesk')).toEqual(['400', '500', '600', '700']);
    expect(source).toContain(`weight: ['400', '500', '600', '700']`);
    expect(weights('IBM Plex Mono')).toEqual(['400', '500', '600']);
    expect(source).toContain(`weight: ['400', '500', '600']`);
    // Inter is the one family ui-kit loads without a weight list, so next/font serves the variable
    // font and so does this.
    expect(weights('Inter')).toEqual(['100 900']);
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
