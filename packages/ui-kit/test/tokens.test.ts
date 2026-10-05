import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REFERENCE_HTML, TOKEN_COUNT, parseRootTokens, rootBlocks } from '../scripts/extract-tokens.js';

const html = readFileSync(REFERENCE_HTML, 'utf8');

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

  it('rejects a repeated name inside one block', () => {
    expect(() => parseRootTokens('<style>:root{--a:1px;--a:2px;}</style>')).toThrow(/--a/);
  });
});
