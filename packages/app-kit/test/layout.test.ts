import { BREAKPOINTS } from '@komtru/ui-kit';
import { describe, expect, it } from 'vitest';
import { compiledStyles, parseRules } from './css.js';
import { SHELL_BREAKPOINT, SHELL_MEDIA_QUERY, SHELL_VARIANT, shellForWidth } from '../src/layout.js';

/**
 * Compiles one Tailwind class and returns the `@media` condition it lands inside. This is the only
 * thing that holds the constant and the variant together: a preset that redefined `md` would
 * otherwise move the shell swap and nothing would say so.
 */
const mediaConditionOf = async (className: string): Promise<string | undefined> => {
  const { compile } = await import('tailwindcss');
  const { readFile } = await import('node:fs/promises');
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const require_ = createRequire(import.meta.url);
  const preset = require_.resolve('@komtru/config/tailwind/preset.css');
  const built = await compile(await readFile(preset, 'utf8'), {
    base: path.dirname(preset),
    loadStylesheet: async (id: string, base: string) => {
      const specifier = id === 'tailwindcss' ? 'tailwindcss/index.css' : id;
      const resolved = specifier.startsWith('.')
        ? path.resolve(base, specifier)
        : require_.resolve(specifier);
      return { path: resolved, base: path.dirname(resolved), content: await readFile(resolved, 'utf8') };
    },
  });
  const css = built.build([className]);
  const rule = parseRules(css).find((candidate) =>
    candidate.selectors.some((selector) => selector.replace(/\\/g, '') === `.${className}`),
  );
  return rule?.atRules.find((at) => at.startsWith('@media'))?.replace(/^@media\s+/, '');
};

describe('the shell swap breakpoint', () => {
  it('is md, the breakpoint ui-kit exports and nothing enforced', () => {
    expect(SHELL_BREAKPOINT).toBe(768);
    expect(SHELL_BREAKPOINT).toBe(BREAKPOINTS.md);
  });

  it('swaps at the breakpoint, not after it', () => {
    expect(shellForWidth(767)).toBe('mobile');
    expect(shellForWidth(768)).toBe('desktop');
    expect(shellForWidth(1440)).toBe('desktop');
  });

  it('calls everything below it mobile, including a width no device has', () => {
    expect(shellForWidth(0)).toBe('mobile');
    expect(shellForWidth(320)).toBe('mobile');
  });

  it('holds the rem and the px together, which is the bridge T-013 left open', () => {
    // Tailwind writes md as 48rem; the reference's own breakpoint note says 768px. They are the
    // same thing only at a 16px root, and this is where that assumption is written down.
    expect(48 * 16).toBe(SHELL_BREAKPOINT);
  });

  it('is the same width Tailwind compiles the md: variant to', async () => {
    expect(await mediaConditionOf(`${SHELL_VARIANT}:hidden`)).toBe(SHELL_MEDIA_QUERY);
  });

  it('is a rule, not a component: the stylesheet it ships swaps nothing by itself', async () => {
    // Deliberate. A runtime swap would mean either two shells in the DOM around one page — two
    // `main` landmarks and two copies of every form control — or a client boundary and a hydration
    // flash around every screen. See the ticket note.
    const emitted = await compiledStyles();
    expect(emitted).not.toContain(SHELL_MEDIA_QUERY);
  });
});
