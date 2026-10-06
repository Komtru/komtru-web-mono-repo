/**
 * The ticket names three widths; the reference states them in prose rather than in a token, and
 * Tailwind ships them as its defaults in `rem`. Both ends are read rather than trusted: the
 * reference's own `.breakpoint-note` blocks, and what the preset actually compiles.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REFERENCE_HTML } from '../../scripts/extract-tokens.js';
import { BREAKPOINTS } from '../../src/shells/breakpoints.js';
import { compileUtilities } from '../reference-css.js';

const html = readFileSync(REFERENCE_HTML, 'utf8');

/** The CSS root font size every `rem` in the compiled sheet is relative to. */
const REM = 16;

describe('BREAKPOINTS', () => {
  it('states the same three widths the reference states for itself', () => {
    const notes = [...html.matchAll(/class="breakpoint-note"[\s\S]*?<\/div>\s*<\/div>/g)].map(
      (match) => match[0],
    );
    // The reference restates the breakpoints once per desktop/tablet section; both have to agree,
    // because a shell built against one of them would be wrong at the other's screens.
    expect(notes.length).toBeGreaterThanOrEqual(2);
    for (const note of notes) {
      for (const [name, width] of Object.entries(BREAKPOINTS)) {
        expect(note, `a breakpoint note stops naming ${name}`).toContain(name);
        expect(note, `a breakpoint note stops naming ${String(width)}px`).toContain(String(width));
      }
    }
  });

  it('maps each name to the pixel width the preset compiles it to', async () => {
    const css = await compileUtilities(Object.keys(BREAKPOINTS).map((name) => `${name}:block`));
    for (const [name, pixels] of Object.entries(BREAKPOINTS)) {
      const found = new RegExp(String.raw`@media \(width >= ([\d.]+)rem\) \{\s*\.${name}\\:block`).exec(css);
      expect(found, `${name}: compiles no media query`).not.toBeNull();
      expect(Number(found?.[1]) * REM, `${name}: fires at the wrong width`).toBe(pixels);
    }
  });

  it('introduces no custom screen — these are Tailwind’s own defaults', async () => {
    // A `--breakpoint-*` in the preset would mean the generated stylesheet had grown a value the
    // reference's `:root` never declared, which T-011's parity test would not catch.
    const css = await compileUtilities(['lg:block']);
    expect(css).not.toContain('--breakpoint-');
  });
});
