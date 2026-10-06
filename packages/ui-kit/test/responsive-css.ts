/**
 * `compiledDeclarations` drops every variant class, which is the right call for a primitive: its
 * reference rule is unconditional. A shell's is not — the whole point of `.dweb-content` beside
 * `.tweb-content` is that the same element is 24px of padding at one width and 20px at another —
 * so the shells are compared against the reference at the width the reference draws them at.
 *
 * This resolves the cascade the way a browser does at a given viewport width: compile everything,
 * keep the rules whose enclosing `@media` conditions hold, and merge them in emission order.
 */
import { canonicalise, compileUtilities, unescape } from './reference-css.js';

/** The CSS root font size Tailwind's `rem` breakpoints are relative to. */
const REM = 16;

interface ConditionalRule {
  selectors: string[];
  declarations: Map<string, string>;
  /** Every at-rule prelude this rule is nested inside, outermost first. */
  conditions: string[];
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Splits declarations on `;` at paren depth zero, so `rgba(13, 20, 32, .55)` survives. */
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
    if (property !== '')
      out.set(
        property,
        part
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, ' '),
      );
  }
  return out;
}

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
 * Every style rule in the sheet, in emission order, each carrying the at-rule preludes it is nested
 * inside. Unlike `parseRules`, nothing is filtered by at-rule name here: a `@media` this width does
 * not satisfy still has to be *seen*, or a `lg:` utility would be indistinguishable from a typo.
 */
function parseConditionalRules(css: string): ConditionalRule[] {
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
            // `@keyframes` and `@property` bodies are not rules a class can match.
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

/**
 * Whether a `@media` prelude holds at `width`. Tailwind v4 emits range syntax (`(width >= 64rem)`)
 * for its own screens; `min-width`/`max-width` are supported too because a `@media` an arbitrary
 * variant produces is written however the author wrote it. Anything else throws rather than
 * silently counting as satisfied — a condition this cannot read is a condition it cannot honour.
 */
function mediaHolds(prelude: string, width: number): boolean {
  const body = prelude.replace(/^@media\s*/, '').trim();
  const toPixels = (value: string, unit: string): number =>
    unit === 'rem' ? Number(value) * REM : Number(value);
  const clauses = body.split(/\s+and\s+/);
  return clauses.every((clause) => {
    const range = /^\(width\s*(>=|<=|>|<)\s*([\d.]+)(rem|px)\)$/.exec(clause.trim());
    if (range !== null) {
      const bound = toPixels(range[2] ?? '', range[3] ?? 'px');
      switch (range[1]) {
        case '>=':
          return width >= bound;
        case '<=':
          return width <= bound;
        case '>':
          return width > bound;
        default:
          return width < bound;
      }
    }
    const minMax = /^\((min|max)-width:\s*([\d.]+)(rem|px)\)$/.exec(clause.trim());
    if (minMax !== null) {
      const bound = toPixels(minMax[2] ?? '', minMax[3] ?? 'px');
      return minMax[1] === 'min' ? width >= bound : width <= bound;
    }
    throw new Error(`Cannot evaluate the media condition "${clause.trim()}" at ${String(width)}px`);
  });
}

/** Tailwind's own screen names. A class prefixed with one of these is the only variant resolved here. */
const SCREENS = ['sm', 'md', 'lg', 'xl', '2xl'];

/** The variant segments of a class name, split on the colons outside its brackets. */
function segments(className: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of className) {
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    if (char === ':' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

/**
 * A width decides whether `lg:block` applies; it decides nothing about `focus-visible:outline-none`
 * or `motion-reduce:transition-none`. Those are left out exactly as `compiledDeclarations` leaves
 * them out, and asserted by the component's own test, so a shell's class list can carry both.
 */
function isWidthResolvable(className: string): boolean {
  const parts = segments(className);
  if (parts.length === 1) return true;
  return parts.length === 2 && SCREENS.includes(parts[0] ?? '');
}

/**
 * What a list of Tailwind classes computes to on one element at a given viewport width. Returns the
 * same shape `compiledDeclarations` does — shorthands expanded, tokens resolved, hex normalised —
 * so a parity row can be compared against a reference rule either way.
 */
export async function declarationsAtWidth(
  classNames: readonly string[],
  width: number,
): Promise<Map<string, string>> {
  const candidates = [...new Set(classNames)].filter((name) => name !== '' && isWidthResolvable(name));
  const css = await compileUtilities(candidates);
  const rules = parseConditionalRules(css);

  const wanted = new Set(candidates.map((name) => `.${name}`));
  const seenAtAnyWidth = new Set<string>();
  const themeVars = new Map<string, string>();
  const merged = new Map<string, string>();

  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if ([':root', ':host', '*', '::before', '::after', '::backdrop'].includes(selector)) {
        for (const [property, value] of rule.declarations) {
          if (property.startsWith('--')) themeVars.set(property, value);
        }
      }
      const key = unescape(selector);
      if (!wanted.has(key)) continue;
      seenAtAnyWidth.add(key);
      if (!rule.conditions.every((condition) => mediaHolds(condition, width))) continue;
      for (const [property, value] of rule.declarations) merged.set(property, value);
    }
  }

  for (const candidate of candidates) {
    // Checked against *any* width, not this one: a `lg:` utility legitimately matches nothing at
    // 640, and failing there would make the evaluator unusable at the widths it exists to test.
    if (seenAtAnyWidth.has(`.${candidate}`)) continue;
    throw new Error(`"${candidate}" compiles to no rule — it is not a utility this preset publishes`);
  }

  // Tailwind defers the border and outline style through a custom property so `border` and
  // `border-dashed` compose; resolve them so the comparison sees `dashed`, not the variable.
  for (const name of ['--tw-border-style', '--tw-outline-style'] as const) {
    const resolved = merged.get(name) ?? 'solid';
    for (const [property, value] of merged) {
      if (value.includes(`var(${name})`)) merged.set(property, value.replaceAll(`var(${name})`, resolved));
    }
  }
  return canonicalise(merged, themeVars);
}
