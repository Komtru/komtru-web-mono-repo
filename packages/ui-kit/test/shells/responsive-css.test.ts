import { describe, expect, it } from 'vitest';
import { compiledDeclarations } from '../reference-css.js';
import { declarationsAtWidth } from '../responsive-css.js';

describe('declarationsAtWidth', () => {
  it('ignores a variant whose media query the width does not satisfy', async () => {
    const at = await declarationsAtWidth(['p-[20px]', 'lg:p-[24px]'], 768);
    expect(at.get('padding-top')).toBe('20px');
  });

  it('applies it once the width does', async () => {
    const at = await declarationsAtWidth(['p-[20px]', 'lg:p-[24px]'], 1024);
    expect(at.get('padding-top')).toBe('24px');
  });

  it('resolves two satisfied variants by emission order, the way a browser does', async () => {
    // Not the order they sit in the `class` attribute: Tailwind sorts its own output, and the
    // later rule wins. `lg:` is emitted after `md:`, so at 1440 the display is `flex`.
    const at = await declarationsAtWidth(['hidden', 'md:block', 'lg:flex'], 1440);
    expect(at.get('display')).toBe('flex');
  });

  it('agrees with `compiledDeclarations` when nothing is responsive', async () => {
    const classes = ['bg-surface-primary', 'rounded-md', 'p-[16px]', 'border', 'border-border-hairline'];
    expect(await declarationsAtWidth(classes, 1440)).toEqual(await compiledDeclarations(classes));
  });

  it('refuses a class the preset does not publish, at any width', async () => {
    // `bg-white` is exactly the trap: T-011 retired Tailwind's own palette, so it compiles to
    // nothing and would otherwise be indistinguishable from a variant this width filters out.
    await expect(declarationsAtWidth(['lg:bg-white'], 1440)).rejects.toThrow('compiles to no rule');
  });

  it('keeps a utility the width filters out from counting as a typo', async () => {
    const at = await declarationsAtWidth(['block', 'lg:hidden'], 640);
    expect(at.get('display')).toBe('block');
  });
});

describe('variants a width cannot decide', () => {
  it('leaves a pseudo-class variant out, as the width-blind reader does', async () => {
    // A shell's class list carries the focus ring and `motion-reduce:`; neither is something a
    // viewport width settles, and both are asserted by the component's own test.
    const at = await declarationsAtWidth(['block', 'focus-visible:outline-[2.5px]'], 1440);
    expect(at.has('outline-width')).toBe(false);
    expect(at.get('display')).toBe('block');
  });

  it('still resolves a screen variant written alongside one', async () => {
    const at = await declarationsAtWidth(['hidden', 'lg:block', 'hover:bg-surface-secondary'], 1440);
    expect(at.get('display')).toBe('block');
    expect(at.has('background-color')).toBe(false);
  });
});
