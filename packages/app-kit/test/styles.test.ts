import { REFERENCE_HTML } from '@komtru/ui-kit/extract-tokens';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compiledStyles,
  declarationsOf,
  parseRules,
  resolved,
  sourceDirectories,
  sourceExclusions,
  STYLESHEET,
} from './css.js';

const sheet = readFileSync(STYLESHEET, 'utf8');
const referenceHtml = readFileSync(fileURLToPath(REFERENCE_HTML), 'utf8');
const previewCss = readFileSync(
  fileURLToPath(new URL('../../ui-kit/.storybook/preview.css', import.meta.url)),
  'utf8',
);

let emitted = '';
beforeAll(async () => {
  emitted = await compiledStyles();
});

describe('the global line-height, which T-013 and T-014 both attributed to this ticket', () => {
  it('still matches the reference, which declares no global line-height anywhere', () => {
    // The reference's `body` rule is `margin / font-family / background / color /
    // -webkit-font-smoothing` and nothing else, restated five times, and no `html` or `*` rule
    // carries a line-height either. So every element that states none is `normal` there — and
    // Tailwind's preflight makes it `1.5` in anything built on the preset. That is the 1-2px per
    // paragraph the visual checks measured. The day the reference gains one, this fails.
    const globals = parseRules(referenceHtml).filter((rule) =>
      rule.selectors.some((selector) => ['body', 'html', '*', ':root'].includes(selector)),
    );
    expect(globals.length).toBeGreaterThan(4);
    for (const rule of globals) {
      expect([...rule.declarations.keys()], rule.selectors.join(', ')).not.toContain('line-height');
    }
  });

  it("undoes preflight, so an element that states no line-height is the reference's normal", async () => {
    expect(await resolved('html', 'line-height')).toBe('normal');
  });

  it.each(['html', 'body', 'h1', 'p', 'img', 'svg', ':focus-visible'])(
    'puts its rule for %s in @layer base, so a utility still beats it',
    (selector) => {
      // Unlayered declarations beat layered ones before specificity is consulted (CSS Cascade 5
      // §6.4.4). Leaving these unlayered would mean `p { margin: 0 }` beating `mb-[14px]`,
      // `img, svg { display: block }` beating `hidden`, and `:focus-visible { border-radius: 4px }`
      // snapping every button, input and chip to a 4px radius the moment it takes focus — which is
      // the opposite of what `ui-kit`'s `focus.ts` says the global rule does.
      const rules = parseRules(emitted).filter((rule) => rule.selectors.includes(selector));
      expect(rules.length, selector).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(
          rule.atRules.some((at) => at.startsWith('@layer')),
          selector,
        ).toBe(true);
      }
    },
  );

  it.each([
    ['p', 'mb-[14px]', 'margin'],
    ['img', 'hidden', 'display'],
    [':focus-visible', 'rounded-sm', 'border-radius'],
    ['h1', 'tracking-normal', 'letter-spacing'],
  ])("a %s carrying .%s keeps the utility's %s", async (selector, utility, property) => {
    const layerOf = (rule: { atRules: string[] }) =>
      rule.atRules.find((at) => at.startsWith('@layer')) ?? '(unlayered)';
    const rules = parseRules(await compiledStyles(utility));
    // The last rule in the sheet that states this property for this selector is this package's;
    // preflight states some of them too, earlier in the same layer.
    const element = rules
      .filter((rule) => rule.selectors.includes(selector) && rule.declarations.has(property))
      .at(-1);
    const utilityRule = rules.find((rule) =>
      rule.selectors.some((candidate) => candidate.replace(/\\/g, '') === `.${utility}`),
    );
    expect(element, `nothing declares ${property} for ${selector}`).toBeDefined();
    expect(utilityRule, `${utility} compiled to no rule`).toBeDefined();
    // Both layered, and `utilities` comes after `base` in Tailwind's own `@layer` statement, so
    // the utility wins. Unlayered, the element rule would win and the utility would do nothing.
    expect(layerOf(element!)).toBe('@layer base');
    expect(layerOf(utilityRule!)).toBe('@layer utilities');
  });

  it('leaves preflight itself in place: the rule is an override, not a fork of the reset', () => {
    const preflight = parseRules(emitted).filter(
      (rule) => rule.selectors.includes('html') && rule.atRules.some((at) => at.startsWith('@layer')),
    );
    expect(preflight.some((rule) => rule.declarations.get('line-height') === '1.5')).toBe(true);
  });
});

describe('the element defaults the reference states', () => {
  it.each([
    ['margin', '0'],
    ['font-family', 'var(--font-body)'],
    ['background', 'var(--cloud-gray)'],
    ['color', 'var(--midnight-text)'],
    ['-webkit-font-smoothing', 'antialiased'],
  ])('body %s is %s', async (property, value) => {
    expect(await resolved('body', property)).toBe(value);
  });

  it('gives headings the display family and the reference tracking', async () => {
    expect(await resolved('h1', 'font-family')).toBe('var(--font-display)');
    expect(await resolved('h4', 'letter-spacing')).toBe('-0.01em');
  });

  it('draws images and icons as blocks, so no baseline gap appears under one', async () => {
    expect(await resolved('img', 'display')).toBe('block');
    expect(await resolved('svg', 'display')).toBe('block');
  });
});

describe('what ui-kit cannot ship and T-011 left here', () => {
  it.each(['shimmer', 'nodePulse'])('carries @keyframes %s, or the loaders sit still', (name) => {
    expect(sheet).toMatch(new RegExp(`@keyframes\\s+${name}`));
    expect(emitted).toMatch(new RegExp(`@keyframes\\s+${name}`));
  });

  it("carries the global focus ring a screen's own focusable elements depend on", async () => {
    // The primitives each carry the ring as a utility; anything a *screen* makes focusable gets it
    // only from here, so without this rule those elements have a ring in Storybook and none in the app.
    expect(await resolved(':focus-visible', 'outline')).toBe('2.5px solid var(--trust-indigo)');
    expect(await resolved(':focus-visible', 'outline-offset')).toBe('2px');
  });
});

describe('the Tailwind sources', () => {
  it('names directories that exist, because a wrong @source fails silently', () => {
    const directories = sourceDirectories(sheet);
    expect(directories.length).toBeGreaterThan(0);
    for (const directory of directories) expect(existsSync(directory), directory).toBe(true);
  });

  it('scans both packages whose class names live in node_modules from an app', () => {
    // Tailwind v4 does not scan node_modules, and from an app `@komtru/ui-kit` and `@komtru/app-kit`
    // are exactly that. Without these, every utility those packages use is absent from the build.
    const packages = sourceDirectories(sheet).map((directory) => basename(dirname(directory)));
    expect(packages).toEqual(expect.arrayContaining(['app-kit', 'ui-kit']));
  });

  it("keeps the stories out, so Storybook's class names do not ship in every app", () => {
    expect(sourceExclusions(sheet)).toContain('../../ui-kit/src/**/*.stories.tsx');
  });
});

describe('agreement with the Storybook preview', () => {
  it('layers its rules the same way, or a story shows a radius the app does not', () => {
    // `preview.css` carries the same declarations for Storybook. Unlayered there, `:focus-visible
    // { border-radius: 4px }` beats `rounded-sm` on every focused control in every story — the bug
    // this package just fixed, in the one place that is meant to show what the app looks like.
    for (const rule of parseRules(previewCss)) {
      if (rule.selectors.some((selector) => selector.startsWith('.'))) continue;
      expect(rule.atRules, rule.selectors.join(', ')).toContain('@layer base');
    }
  });

  it.each(['body', 'h1,\nh2,\nh3,\nh4', 'p', 'img,\nsvg', ':focus-visible'])(
    'declares exactly what the stories declare for %j',
    (previewSelector) => {
      // The stories are the only place these rules are looked at today. A story that lies about the
      // app is worse than no story, so the two files are held to the same declarations.
      const expected = declarationsOf(previewCss, previewSelector.replace(/\n/g, ' '));
      const actual = declarationsOf(sheet, previewSelector.replace(/\n/g, ' '));
      expect(expected, `preview.css has no rule for ${previewSelector}`).toBeDefined();
      expect(actual).toEqual(expected);
    },
  );
});
