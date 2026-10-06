import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const shells = path.join(here, '../../src/shells');
const sources = readdirSync(shells).filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'));
const components = sources.filter((name) => !name.endsWith('.stories.tsx'));

/** A hook call means React has to run the module on the client. */
const HOOK = /\buse(State|Effect|LayoutEffect|Ref|Id|Reducer|Callback|Memo|Transition|SyncExternalStore)\(/;

describe('the shell sources', () => {
  it('never reaches for ./fonts, which throws outside a Next build', () => {
    for (const name of sources) {
      const source = readFileSync(path.join(shells, name), 'utf8');
      expect(source, `${name} imports fonts`).not.toMatch(/from '\.\.?\/fonts/);
      expect(source, `${name} imports next/font`).not.toContain('next/font');
    }
  });

  it('stays entirely on the server', () => {
    // Every shell is a layout: it holds a page's chrome and forwards whatever handler a screen
    // gives it. A shell that grew state would push a client boundary around every screen in the
    // product, so the absence of one is worth asserting rather than assuming.
    for (const name of components) {
      const source = readFileSync(path.join(shells, name), 'utf8');
      expect(HOOK.test(source), `${name} uses a hook`).toBe(false);
      expect(source.startsWith("'use client';"), `${name} declares a client boundary`).toBe(false);
    }
  });

  it('defines no event handler of its own, only forwards the caller’s', () => {
    // `onClick={item.onSelect}` crosses the server boundary; `onClick={() => …}` does not.
    for (const name of components) {
      const source = readFileSync(path.join(shells, name), 'utf8');
      for (const match of source.matchAll(/\bon[A-Z]\w*=\{/g)) {
        let depth = 1;
        let index = match.index + match[0].length;
        const start = index;
        while (index < source.length && depth > 0) {
          if (source[index] === '{') depth += 1;
          else if (source[index] === '}') depth -= 1;
          index += 1;
        }
        const value = source.slice(start, index - 1);
        expect(/=>|\bfunction\b/.test(value), `${name} defines ${match[0]}${value}}`).toBe(false);
      }
    }
  });
});
