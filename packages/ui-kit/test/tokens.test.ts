/* eslint-disable komtru-design/no-raw-hex -- the parity test is the one place that must restate the
   reference's own colours; reading them from the tokens would make the assertions circular. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE_HTML,
  TOKEN_COUNT,
  parseCssDeclarations,
  parseRootTokens,
  renderTokensCss,
  renderTailwindPreset,
  renderTokensTs,
  rootBlocks,
} from '../scripts/extract-tokens.js';
import { KOMTRU_TOKENS, cssVar } from '../src/tokens.js';

const html = readFileSync(REFERENCE_HTML, 'utf8');

const readArtefact = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

/** The body of the block opened by `header`, so the test reads a generated file back structurally. */
const blockOf = (css: string, header: string) => {
  const start = css.indexOf(header);
  if (start === -1) throw new Error(`No ${header} block`);
  const open = start + header.length;
  const end = css.indexOf('}', open);
  if (end === -1) throw new Error(`Unterminated ${header} block`);
  return css.slice(open, end);
};

describe('the reference HTML', () => {
  it('declares five identical :root blocks', () => {
    expect(rootBlocks(html)).toHaveLength(5);
  });

  it('declares exactly 52 custom properties', () => {
    expect(parseRootTokens(html).size).toBe(TOKEN_COUNT);
  });

  it('keeps the named token values', () => {
    const tokens = parseRootTokens(html);
    expect(tokens.get('--trust-indigo')).toBe('#4552D6');
    expect(tokens.get('--success-on-soft')).toBe('#0C6B49');
    expect(tokens.get('--font-display')).toBe("'Space Grotesk','Inter',sans-serif");
    expect(tokens.get('--sp-12')).toBe('48px');
    expect(tokens.get('--r-full')).toBe('999px');
    expect(tokens.get('--shadow-card')).toBe('0 1px 2px rgba(13,20,32,0.04), 0 4px 16px rgba(13,20,32,0.06)');
    expect(tokens.get('--dur-brand')).toBe('700ms');
    expect(tokens.get('--ease-standard')).toBe('cubic-bezier(.4,0,.2,1)');
  });

  it('introduces no dark theme', () => {
    expect(html).not.toMatch(/prefers-color-scheme|\.dark\b/);
  });
});

describe('parseRootTokens', () => {
  it('rejects blocks that disagree', () => {
    const drifted = html.replace('--trust-indigo:#4552D6', '--trust-indigo:#4552D7');
    expect(() => parseRootTokens(drifted)).toThrow(/--trust-indigo/);
  });

  it('ignores a CSS comment inside a block', () => {
    const tokens = parseRootTokens('<style>:root{/* a note; with a semicolon */--a:1px;}</style>');
    expect([...tokens]).toEqual([['--a', '1px']]);
  });

  it('rejects a repeated name inside one block', () => {
    expect(() => parseRootTokens('<style>:root{--a:1px;--a:2px;}</style>')).toThrow(/--a/);
  });
});

describe('generated artefacts', () => {
  it('tokens.css declares exactly the HTML tokens', () => {
    expect(parseCssDeclarations(blockOf(readArtefact('src/tokens.css'), ':root {'))).toEqual(
      parseRootTokens(html),
    );
  });

  it('tokens.ts exports exactly the HTML tokens', () => {
    expect(new Map(Object.entries(KOMTRU_TOKENS))).toEqual(parseRootTokens(html));
  });

  it('is byte-identical to a fresh render', () => {
    expect(readArtefact('src/tokens.css')).toBe(renderTokensCss(parseRootTokens(html)));
    expect(readArtefact('src/tokens.ts')).toBe(renderTokensTs(parseRootTokens(html)));
  });

  it('cssVar quotes a token for inline use', () => {
    expect(cssVar('--trust-emerald')).toBe('var(--trust-emerald)');
  });
});

describe('the tailwind preset', () => {
  const preset = () => readFileSync(new URL('../../config/tailwind/preset.css', import.meta.url), 'utf8');

  it('declares exactly the HTML tokens, across its two blocks', () => {
    const declared = new Map([
      ...parseCssDeclarations(blockOf(preset(), '@theme static {')),
      ...parseCssDeclarations(blockOf(preset(), ':root {')),
    ]);
    expect(declared).toEqual(parseRootTokens(html));
  });

  it('aliases every token whose tailwind namespace differs, and never self-references', () => {
    const aliases = parseCssDeclarations(blockOf(preset(), '@theme inline {'));
    expect(aliases.get('--color-trust-indigo')).toBe('var(--trust-indigo)');
    expect(aliases.get('--color-success-on-soft')).toBe('var(--success-on-soft)');
    expect(aliases.get('--spacing-4')).toBe('var(--sp-4)');
    expect(aliases.get('--radius-md')).toBe('var(--r-md)');
    expect(aliases.get('--radius-full')).toBe('var(--r-full)');
    // `rounded-r-md` would also match tailwind's own `rounded-{side}` modifier.
    expect(aliases.has('--radius-r-md')).toBe(false);
    for (const [name, value] of aliases) expect(value).not.toBe(`var(${name})`);
  });

  it('is byte-identical to a fresh render', () => {
    expect(preset()).toBe(renderTailwindPreset(parseRootTokens(html)));
  });
});
