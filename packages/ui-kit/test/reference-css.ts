/**
 * The machinery behind `primitives-parity.test.tsx`.
 *
 * A primitive is only honest if what it compiles to matches what the reference HTML declares, so
 * both sides are reduced to the same shape: shorthands expanded into physical longhands, every
 * `var(--token)` resolved to the literal the reference gives it, hex normalised. What is left is two
 * plain property maps that can be diffed property by property.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { KOMTRU_TOKENS } from '../src/tokens.js';

const require_ = createRequire(import.meta.url);

/** A `selector { … }` rule, flattened out of a stylesheet. */
export interface CssRule {
  selectors: string[];
  declarations: Map<string, string>;
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Splits a selector list on the commas that separate selectors, not the ones a selector escapes. */
function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < prelude.length; i += 1) {
    const char = prelude[i];
    if (char === '\\') {
      current += char + (prelude[i + 1] ?? '');
      i += 1;
    } else if (char === ',') {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((selector) => selector.replace(/\s+/g, ' ').trim()).filter((s) => s !== '');
}

/**
 * Splits declarations on `;` at paren depth zero, so `--shadow-card: 0 1px 2px rgba(…), …` survives.
 * Same splitter the token extractor uses, restated here because that one parses `:root` only.
 */
function parseDeclarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ';' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const property = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (property !== '') out.set(property, value.replace(/\s+/g, ' '));
  }
  return out;
}

/**
 * Flattens a stylesheet into its top-level rules. `@media`, `@supports` and `@layer` bodies are
 * descended into only when `includeAtRules` names them; `@keyframes` and `@property` never are,
 * because their inner blocks are not rules that a class can match.
 */
export function parseRules(css: string, includeAtRules: string[] = []): CssRule[] {
  const rules: CssRule[] = [];
  const walk = (text: string) => {
    let depth = 0;
    let preludeStart = 0;
    let bodyStart = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '{') {
        if (depth === 0) bodyStart = i;
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const prelude = text.slice(preludeStart, bodyStart).trim();
          const body = text.slice(bodyStart + 1, i);
          if (prelude.startsWith('@')) {
            const name = /^@([\w-]+)/.exec(prelude)?.[1] ?? '';
            if (includeAtRules.includes(name)) walk(body);
          } else if (prelude !== '') {
            rules.push({
              // Not a plain `split(',')`: Tailwind escapes the commas inside an arbitrary value
              // (`.bg-\[rgba\(13\,20\,32\,.55\)\]`), and splitting those would shred the selector.
              selectors: splitSelectors(prelude),
              declarations: parseDeclarations(body),
            });
          }
          preludeStart = i + 1;
        }
      }
    }
  };
  walk(stripComments(css));
  return rules;
}

/** A rule together with the `@media` preludes it is nested inside, outermost first. */
export interface ConditionalRule extends CssRule {
  conditions: string[];
}

/**
 * Every style rule in a stylesheet, in emission order, each carrying the `@media` preludes it sits
 * inside. `parseRules` descends into those at-rules and throws the prelude away, which conflates a
 * responsive override with the rule it overrides; this keeps them apart.
 */
export function parseConditionalRules(css: string): ConditionalRule[] {
  const rules: ConditionalRule[] = [];
  const walk = (text: string, conditions: string[]) => {
    let depth = 0;
    let preludeStart = 0;
    let bodyStart = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '{') {
        if (depth === 0) bodyStart = i;
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const prelude = text.slice(preludeStart, bodyStart).trim();
          const body = text.slice(bodyStart + 1, i);
          if (prelude.startsWith('@')) {
            const name = /^@([\w-]+)/.exec(prelude)?.[1] ?? '';
            // `@keyframes`, `@property` and `@font-face` bodies are not rules a class can match.
            if (!['keyframes', 'property', 'font-face'].includes(name)) {
              walk(body, name === 'media' ? [...conditions, prelude] : conditions);
            }
          } else if (prelude !== '') {
            rules.push({
              selectors: splitSelectors(prelude),
              declarations: parseDeclarations(body),
              conditions,
            });
          }
          preludeStart = i + 1;
        }
      }
    }
  };
  walk(stripComments(css), []);
  return rules;
}

/** The CSS root font size a `rem` in a media condition is relative to. */
const REM = 16;

/**
 * Whether a `@media` prelude holds at a viewport width. Both sides are read through this: the
 * reference writes `(max-width:900px)`, Tailwind v4 writes range syntax. A condition this cannot
 * read throws rather than counting as satisfied — silently honouring an unreadable condition is
 * how a rule gets merged that the width never applies.
 */
export function mediaHolds(prelude: string, width: number): boolean {
  const body = prelude.replace(/^@media\s*/, '').trim();
  const pixels = (value: string, unit: string): number =>
    unit === 'rem' ? Number(value) * REM : Number(value);
  return body.split(/\s+and\s+/).every((clause) => {
    const range = /^\(width\s*(>=|<=|>|<)\s*([\d.]+)(rem|px)\)$/.exec(clause.trim());
    if (range !== null) {
      const bound = pixels(range[2] ?? '', range[3] ?? 'px');
      if (range[1] === '>=') return width >= bound;
      if (range[1] === '<=') return width <= bound;
      if (range[1] === '>') return width > bound;
      return width < bound;
    }
    const minMax = /^\((min|max)-width:\s*([\d.]+)(rem|px)\)$/.exec(clause.trim());
    if (minMax !== null) {
      const bound = pixels(minMax[2] ?? '', minMax[3] ?? 'px');
      return minMax[1] === 'min' ? width >= bound : width <= bound;
    }
    throw new Error(`Cannot evaluate the media condition "${clause.trim()}" at ${String(width)}px`);
  });
}

/** Every `<style>` block in the reference document, in source order, with its id when it has one. */
export function styleBlocks(html: string): { id: string | undefined; css: string }[] {
  return [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map((match) => ({
    id: /id="([^"]*)"/.exec(match[1] ?? '')?.[1],
    css: match[2] ?? '',
  }));
}

/**
 * The declarations the reference HTML gives a selector. The reference restates its component rules
 * in five near-identical `<style>` blocks; every copy is merged in source order, which is what the
 * browser does, and a disagreement between copies is reported rather than silently taking the last.
 */
export function referenceRule(
  html: string,
  selector: string,
  /**
   * The id of the one `<style>` block to read. Needed where the reference carries two designs under
   * the same class name — `.ko-stepper` is a numbered inline rail in `komtru-refinement-v2` and a
   * centred-dot rail in `komtru-nav-v2` — so the component names which one it reproduces.
   */
  styleId?: string,
  /**
   * The viewport width to read the rule at. The reference carries its own responsive overrides —
   * the console sheet collapses the rail under `@media(max-width:900px)` and stacks the page head
   * under `@media(max-width:640px)` — and without a width those are merged into the base rule and
   * reported as the reference disagreeing with itself. Omitted, every copy is merged, which is
   * what an unconditional primitive rule wants.
   */
  options: { atWidth?: number } = {},
): Map<string, string> {
  const wanted = selector.replace(/\s+/g, ' ').trim();
  const merged = new Map<string, string>();
  const seen = new Map<string, string>();
  let found = false;
  for (const block of styleBlocks(html)) {
    if (styleId !== undefined && block.id !== styleId) continue;
    for (const rule of parseConditionalRules(block.css)) {
      if (!rule.selectors.includes(wanted)) continue;
      if (
        options.atWidth !== undefined &&
        !rule.conditions.every((condition) => mediaHolds(condition, options.atWidth ?? 0))
      ) {
        continue;
      }
      // After the width check, so a selector that exists only inside a media query this width does
      // not satisfy reports "declares no rule" rather than silently comparing against nothing.
      found = true;
      for (const [property, value] of rule.declarations) {
        // Keyed by the condition stack as well as the property: the reference restates its
        // component rules in five near-identical blocks, and a disagreement between those copies
        // is a real drift — but a `@media` override legitimately differs from the rule it
        // overrides, and merging in source order is exactly what a browser does with it.
        const key = `${rule.conditions.join(' & ')}|${property}`;
        const previous = seen.get(key);
        if (previous !== undefined && previous !== value) {
          throw new Error(
            `The reference declares ${wanted} { ${property} } twice with different values: ` +
              `"${previous}" and "${value}". Pick the instance deliberately.`,
          );
        }
        seen.set(key, value);
        merged.set(property, value);
      }
    }
  }
  if (!found) {
    throw new Error(
      `The reference HTML declares no rule for "${wanted}"${styleId === undefined ? '' : ` in <style id="${styleId}">`}`,
    );
  }
  return merged;
}

/**
 * The declarations the reference writes inline on an element rather than in a rule. E3b paints the
 * wrong-code cells with `style="border-color:var(--risk); background:var(--risk-soft)"` — there is
 * no `.otp-cell.error` to compare against, so the markup is the only statement of that state.
 */
export function referenceInlineStyle(html: string, classAttribute: string): Map<string, string> {
  const pattern = new RegExp(`class="${classAttribute}" style="([^"]*)"`);
  const found = pattern.exec(html);
  if (found?.[1] === undefined) {
    throw new Error(`The reference has no inline-styled element with class="${classAttribute}"`);
  }
  return parseDeclarations(found[1]);
}

const HEX = /^#([0-9a-fA-F]{3,8})$/;

/** `0px` and `0` are the same length; Tailwind writes one and the reference the other. */
const normaliseLength = (value: string): string => (/^0(px|%|em|rem)$/.test(value) ? '0' : value);

/**
 * The CSS colour keywords the reference writes where it could have written a hex. These two literals
 * are the keywords' own definitions, so naming a design token instead would be circular.
 */
// eslint-disable-next-line komtru-design/no-raw-hex -- see above.
const COLOUR_KEYWORD_HEX: Record<string, string> = { white: '#FFFFFF', black: '#000000' };

/** `#fff`, `#FFFFFF` and `white` are the same colour; the reference writes all three. */
function normaliseHex(value: string): string {
  const keyword = COLOUR_KEYWORD_HEX[value.trim().toLowerCase()];
  if (keyword !== undefined) return keyword;
  const match = HEX.exec(value.trim());
  if (match === null) return value;
  const digits = match[1] ?? '';
  const expanded =
    digits.length === 3 || digits.length === 4 ? [...digits].map((d) => d + d).join('') : digits;
  return `#${expanded.toUpperCase()}`;
}

/**
 * Resolves `var(--trust-indigo)` down to the literal the reference declares for it, and `extra`
 * carries whatever custom properties the compiled stylesheet declared for itself — Tailwind routes
 * `font-semibold` through `var(--font-weight-semibold)` rather than writing `600`.
 */
function resolveTokens(value: string, extra: Map<string, string>): string {
  let resolved = value;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = resolved.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => {
      const token = (KOMTRU_TOKENS as Record<string, string | undefined>)[name] ?? extra.get(name);
      return token ?? whole;
    });
    if (next === resolved) break;
    resolved = next;
  }
  return resolved;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** `12px 18px` → the four physical sides, the way the box-model shorthand expands. */
function expandBox(value: string): [string, string, string, string] {
  const parts = value.split(/\s+/).filter(Boolean);
  const top = parts[0] ?? '0';
  const right = parts[1] ?? top;
  const bottom = parts[2] ?? top;
  const left = parts[3] ?? right;
  return [top, right, bottom, left];
}

/** `20px 20px 0 0` → the four corners, in the order the `border-radius` shorthand names them. */
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

const COLOUR_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit', 'none']);
const isColour = (value: string): boolean =>
  HEX.test(value) ||
  value.startsWith('rgb') ||
  value.startsWith('hsl') ||
  value.startsWith('var(') ||
  COLOUR_KEYWORDS.has(value.toLowerCase());

const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'none', 'hidden']);

/**
 * Reduces one declaration to the physical longhands both sides can be compared on. Tailwind v4
 * writes `padding-inline` where the reference writes `padding`, and `background-color` where the
 * reference writes `background`; expanding both removes the difference without pretending it away.
 */
export function expandDeclaration(property: string, rawValue: string): [string, string][] {
  const value = rawValue.trim();
  switch (property) {
    case 'padding':
    case 'margin': {
      const box = expandBox(value);
      return SIDES.map((side, i) => [`${property}-${side}`, box[i]] as [string, string]);
    }
    case 'padding-inline':
    case 'margin-inline':
    case 'padding-block':
    case 'margin-block': {
      const [base = '', axis = ''] = property.split('-');
      const parts = value.split(/\s+/).filter(Boolean);
      const start = parts[0] ?? '0';
      const end = parts[1] ?? start;
      const [from, to] = axis === 'inline' ? ['left', 'right'] : ['top', 'bottom'];
      return [
        [`${base}-${from}`, start],
        [`${base}-${to}`, end],
      ];
    }
    case 'border-radius': {
      const box = expandBox(value);
      return CORNERS.map((corner, i) => [`border-${corner}-radius`, box[i]] as [string, string]);
    }
    case 'border-width':
    case 'border-color':
    case 'border-style': {
      const facet = property.split('-')[1] ?? '';
      const box = expandBox(value);
      return SIDES.map((side, i) => [`border-${side}-${facet}`, box[i]] as [string, string]);
    }
    case 'border-top':
    case 'border-right':
    case 'border-bottom':
    case 'border-left': {
      // `border-bottom: 1px solid var(--border-hairline)` — the hairline every shell's chrome is
      // separated by. Without this the longhands a `border-b-*` utility emits have nothing to
      // compare against, and a missing hairline reads as a clean pass.
      const side = property.split('-')[1] ?? '';
      const out: [string, string][] = [];
      for (const part of value.split(/\s+/).filter(Boolean)) {
        const facet = BORDER_STYLES.has(part) ? 'style' : isColour(part) ? 'color' : 'width';
        out.push([`border-${side}-${facet}`, part]);
      }
      return out;
    }
    case 'border': {
      const out: [string, string][] = [];
      for (const part of value.split(/\s+/).filter(Boolean)) {
        const facet = BORDER_STYLES.has(part) ? 'style' : isColour(part) ? 'color' : 'width';
        for (const side of SIDES) out.push([`border-${side}-${facet}`, part]);
      }
      return out;
    }
    case 'background': {
      // `background:none` resets every background longhand, which leaves the colour transparent.
      if (value === 'none') return [['background-color', 'transparent']];
      // Only the single-colour shorthand; a gradient stays whole and is compared as written.
      return isColour(value) ? [['background-color', value]] : [[property, value]];
    }
    case 'text-decoration':
      return [['text-decoration-line', value]];
    case 'outline': {
      if (value === 'none') return [['outline-style', 'none']];
      const out: [string, string][] = [];
      for (const part of value.split(/\s+/).filter(Boolean)) {
        if (BORDER_STYLES.has(part)) out.push(['outline-style', part]);
        else if (isColour(part)) out.push(['outline-color', part]);
        else out.push(['outline-width', part]);
      }
      return out;
    }
    case 'font': {
      // `font: 600 11px var(--font-body)` and `font: 12px/1.5 var(--font-body)`.
      const match = /^(?:(\d{3}|bold|normal)\s+)?([\d.]+px)(?:\/([\d.]+))?\s+(.+)$/.exec(value);
      if (match === null) return [[property, value]];
      const out: [string, string][] = [
        ['font-size', match[2] ?? ''],
        ['font-family', match[4] ?? ''],
      ];
      if (match[1] !== undefined) out.push(['font-weight', match[1]]);
      if (match[3] !== undefined) out.push(['line-height', match[3]]);
      return out;
    }
    case 'flex': {
      // `flex: 1` and `flex: 0 0 228px` — the shell's rails are pinned with the shorthand and the
      // utilities that reproduce them (`grow-0 shrink-0 basis-[228px]`) are three longhands, so
      // without this the two sides compare a shorthand against nothing.
      const parts = value.split(/\s+/).filter(Boolean);
      if (parts.length === 1 && /^[\d.]+$/.test(parts[0] ?? '')) {
        return [
          ['flex-grow', parts[0] ?? ''],
          ['flex-shrink', '1'],
          ['flex-basis', '0%'],
        ];
      }
      if (parts.length === 3) {
        return [
          ['flex-grow', parts[0] ?? ''],
          ['flex-shrink', parts[1] ?? ''],
          ['flex-basis', parts[2] ?? ''],
        ];
      }
      return [[property, value]];
    }
    case 'inset': {
      const box = expandBox(value);
      return SIDES.map((side, i) => [side, box[i]] as [string, string]);
    }
    default:
      return [[property, value]];
  }
}

/** Shorthands expanded, tokens resolved, hex normalised — the form the two sides are diffed in. */
export function canonicalise(
  declarations: Map<string, string>,
  extra: Map<string, string> = new Map(),
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [property, value] of declarations) {
    if (property.startsWith('--')) continue;
    for (const [expandedProperty, expandedValue] of expandDeclaration(property, value)) {
      out.set(expandedProperty, normaliseLength(normaliseHex(resolveTokens(expandedValue, extra).trim())));
    }
  }
  return out;
}

const presetPath = require_.resolve('@komtru/config/tailwind/preset.css');

/** Resolves `@import 'tailwindcss'` the way a bundler would, so the preset compiles standalone. */
async function loadStylesheet(id: string, base: string) {
  const specifier = id === 'tailwindcss' ? 'tailwindcss/index.css' : id;
  const resolved = specifier.startsWith('.') ? path.resolve(base, specifier) : require_.resolve(specifier);
  return { path: resolved, base: path.dirname(resolved), content: await readFile(resolved, 'utf8') };
}

let compiled: Promise<(candidates: string[]) => string> | undefined;

function compiler(): Promise<(candidates: string[]) => string> {
  compiled ??= (async () => {
    const built = await compile(await readFile(presetPath, 'utf8'), {
      base: path.dirname(presetPath),
      loadStylesheet,
    });
    return (candidates: string[]) => built.build(candidates);
  })();
  return compiled;
}

/**
 * True for `focus-visible:outline-none`, false for `bg-[length:200%_100%]`: only a colon outside the
 * brackets is Tailwind's variant separator.
 */
function hasVariant(className: string): boolean {
  let depth = 0;
  for (const char of className) {
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    else if (char === ':' && depth === 0) return true;
  }
  return false;
}

/** `.text-\[13\.5px\]` and `text-[13.5px]` name the same utility. */
export const unescape = (selector: string): string => selector.replace(/\\/g, '');

/**
 * The stylesheet the real preset emits for a list of candidates, variants included. Separate from
 * `compiledDeclarations` because `responsive-css.ts` needs the at-rules the declaration-level
 * reader throws away — a `lg:` utility means nothing without the `@media` it was wrapped in.
 */
export async function compileUtilities(classNames: readonly string[]): Promise<string> {
  const build = await compiler();
  return build([...classNames]);
}

/**
 * What a list of Tailwind classes actually computes to. Variant classes (`focus-visible:…`,
 * `motion-reduce:…`) are skipped: they live inside an at-rule or a pseudo-selector and are asserted
 * by the component's own test rather than by parity against a plain reference rule.
 */
export async function compiledDeclarations(classNames: string[]): Promise<Map<string, string>> {
  const utilities = classNames.filter((name) => !hasVariant(name));
  const css = await compileUtilities(utilities);
  const byUtility = new Map<string, Map<string, string>>();
  const themeVars = new Map<string, string>();
  for (const rule of parseRules(css, ['layer', 'supports'])) {
    for (const selector of rule.selectors) {
      if ([':root', ':host', '*', '::before', '::after', '::backdrop'].includes(selector)) {
        for (const [property, value] of rule.declarations) {
          if (property.startsWith('--')) themeVars.set(property, value);
        }
      }
      const key = unescape(selector);
      const existing = byUtility.get(key) ?? new Map<string, string>();
      for (const [property, value] of rule.declarations) existing.set(property, value);
      byUtility.set(key, existing);
    }
  }
  for (const utility of utilities) {
    if (byUtility.has(`.${utility}`)) continue;
    // A class that compiles to nothing is invisible to the diff below, so a retired-palette
    // utility (`bg-white`) or a typo would pass parity by producing no declarations at all.
    throw new Error(`"${utility}" compiles to no rule — it is not a utility this preset publishes`);
  }

  // Emission order, not the order the classes happen to sit in the `class` attribute. Two utilities
  // setting the same property are resolved by where their rules land in the stylesheet — Tailwind
  // sorts them internally — so `cx('bg-stone-gray', 'bg-trust-emerald')` and the reverse render
  // identically. Merging in attribute order modelled a cascade no browser has, and let a component
  // that emits two backgrounds for one element look correct while rendering the other one.
  const wanted = new Set(utilities.map((utility) => `.${utility}`));
  const merged = new Map<string, string>();
  for (const [selector, declarations] of byUtility) {
    if (!wanted.has(selector)) continue;
    for (const [property, value] of declarations) merged.set(property, value);
  }
  // Tailwind defers the border style through a custom property so that `border` and `border-dashed`
  // compose; resolve it here so the comparison sees `dashed`, not the variable.
  for (const name of ['--tw-border-style', '--tw-outline-style'] as const) {
    const resolvedStyle = merged.get(name) ?? 'solid';
    for (const [property, value] of merged) {
      if (value.includes(`var(${name})`)) {
        merged.set(property, value.replaceAll(`var(${name})`, resolvedStyle));
      }
    }
  }
  return canonicalise(merged, themeVars);
}
