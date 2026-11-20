import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KOMTRU_TOKENS } from '../src/tokens.js';

// `next/font/local` is a build-time construct: the Next compiler rewrites the call and the module
// throws when Node imports it. So the parity these tests prove is between the module's source and
// the reference's font stacks, not between runtime values.
const source = readFileSync(new URL('../src/fonts.ts', import.meta.url), 'utf8');

/** `'Space Grotesk','Inter',sans-serif` -> ['Space Grotesk', 'Inter', 'sans-serif'] */
const stackOf = (token: '--font-display' | '--font-body' | '--font-mono') =>
  KOMTRU_TOKENS[token].split(',').map((part) => part.trim().replace(/^'|'$/g, ''));

describe('@komtru/ui-kit/fonts', () => {
  it.each([
    ['--font-display', 'space-grotesk-latin'],
    ['--font-body', 'inter-latin'],
    ['--font-mono', 'ibm-plex-mono-latin'],
  ] as const)('loads %s from its committed file with the reference fallbacks', (token, file) => {
    const [family, ...fallback] = stackOf(token);
    // The file is the reference's family: `Space Grotesk` -> `space-grotesk-latin…`.
    expect(file).toContain(family!.toLowerCase().replaceAll(' ', '-'));
    expect(source).toContain(`'../fonts/${file}`);
    expect(source).toContain(`variable: '${token}'`);
    expect(source).toContain(`fallback: [${fallback.map((f) => `'${f}'`).join(', ')}]`);
  });

  // 2026-11-20: the Google loader fetched at build time and broke CI builds when Google's answer changed.
  it('loads all three from local files, so a build never reaches Google', () => {
    expect(source).toContain("from 'next/font/local'");
    expect(source).not.toContain("from 'next/font/google'");
    expect(source).not.toMatch(/fonts\.googleapis\.com|@font-face/);
  });

  it('commits every file it names', () => {
    for (const [, path] of source.matchAll(/path: '(\.\.\/fonts\/[^']+)'/g))
      expect(existsSync(new URL(`../src/${path!}`, import.meta.url)), path).toBe(true);
  });

  it('exports the three variable class names together', () => {
    expect(source).toMatch(
      /fontVariables[\s\S]*displayFont\.variable[\s\S]*bodyFont\.variable[\s\S]*monoFont\.variable/,
    );
  });

  it('stays off the package root, which must import without a Next build', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/^\s*export\b.*fonts\.js/m);
  });
});
