/**
 * `compiledDeclarations` drops every variant class, which is the right call for a primitive: its
 * reference rule is unconditional. A shell's is not — the whole point of `.dweb-content` beside
 * `.tweb-content` is that the same element is 24px of padding at one width and 20px at another —
 * so the shells are compared against the reference at the width the reference draws them at.
 *
 * This resolves the cascade the way a browser does at a given viewport width: compile everything,
 * keep the rules whose enclosing `@media` conditions hold, and merge them in emission order.
 */
import {
  canonicalise,
  compileUtilities,
  mediaHolds,
  parseConditionalRules,
  unescape,
} from './reference-css.js';

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
