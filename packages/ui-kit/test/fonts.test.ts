import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KOMTRU_TOKENS } from '../src/tokens.js';

// `next/font/google` is a build-time construct: the Next compiler rewrites the call and the module
// throws when Node imports it. So the parity these tests prove is between the module's source and
// the reference's font stacks, not between runtime values.
const source = readFileSync(new URL('../src/fonts.ts', import.meta.url), 'utf8');

/** `'Space Grotesk','Inter',sans-serif` -> ['Space Grotesk', 'Inter', 'sans-serif'] */
const stackOf = (token: '--font-display' | '--font-body' | '--font-mono') =>
  KOMTRU_TOKENS[token].split(',').map((part) => part.trim().replace(/^'|'$/g, ''));

describe('@komtru/ui-kit/fonts', () => {
  it.each([
    ['--font-display', 'Space_Grotesk'],
    ['--font-body', 'Inter'],
    ['--font-mono', 'IBM_Plex_Mono'],
  ] as const)('loads %s through next/font with the reference fallbacks', (token, loader) => {
    const [family, ...fallback] = stackOf(token);
    expect(loader.replaceAll('_', ' ')).toBe(family);
    expect(source).toContain(`import { ${loader}`.slice(0, 9));
    expect(source).toContain(`${loader}(`);
    expect(source).toContain(`variable: '${token}'`);
    expect(source).toContain(`fallback: [${fallback.map((f) => `'${f}'`).join(', ')}]`);
  });

  it('loads all three from next/font/google and nowhere else', () => {
    expect(source).toContain("from 'next/font/google'");
    expect(source).not.toMatch(/fonts\.googleapis\.com|@font-face/);
  });

  it('exports the three variable class names together', () => {
    expect(source).toMatch(
      /fontVariables[\s\S]*displayFont\.variable[\s\S]*bodyFont\.variable[\s\S]*monoFont\.variable/,
    );
  });

  it('stays off the package root, which must import without a Next build', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).not.toContain('fonts.js');
  });
});
