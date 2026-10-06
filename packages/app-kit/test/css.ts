// Compiles `src/styles.css` the way an app's build does, and resolves what a selector ends up
// declaring. Tailwind's preflight lives in `@layer base`; everything this package adds is
// unlayered, and unlayered CSS beats any layer — which is the mechanism the line-height rule relies
// on, so the resolver models it rather than assuming source order.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';

const require_ = createRequire(import.meta.url);

export const STYLESHEET = fileURLToPath(new URL('../src/styles.css', import.meta.url));

export interface CssRule {
  selectors: string[];
  declarations: Map<string, string>;
  /** Nested at-rule preludes, outermost first: `['@layer base']`, `['@media (width >= 48rem)']`. */
  atRules: string[];
}

/** Resolves `@import 'tailwindcss'` and `@import '@komtru/config/...'` the way a bundler would. */
async function loadStylesheet(id: string, base: string) {
  const specifier = id === 'tailwindcss' ? 'tailwindcss/index.css' : id;
  const resolved = specifier.startsWith('.') ? path.resolve(base, specifier) : require_.resolve(specifier);
  return { path: resolved, base: path.dirname(resolved), content: await readFile(resolved, 'utf8') };
}

let compiled: Promise<string> | undefined;

/** The whole emitted sheet, with no utilities asked for: this package declares no classes. */
export function compiledStyles(): Promise<string> {
  compiled ??= (async () => {
    const source = await readFile(STYLESHEET, 'utf8');
    const built = await compile(source, { base: path.dirname(STYLESHEET), loadStylesheet });
    return built.build([]);
  })();
  return compiled;
}

export function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of splitTop(body, ';')) {
    const index = part.indexOf(':');
    if (index === -1) continue;
    const property = part.slice(0, index).trim();
    if (property === '') continue;
    declarations.set(property, part.slice(index + 1).trim());
  }
  return declarations;
}

/** Splits on a separator that is not inside brackets or a string. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Comments first: this package's own stylesheet quotes CSS inside them, braces and all. */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

export function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];

  const walk = (text: string, atRules: string[]): void => {
    let depth = 0;
    let preludeStart = 0;
    let bodyStart = 0;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '{') {
        if (depth === 0) bodyStart = index;
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth > 0) continue;
        const prelude = text.slice(preludeStart, bodyStart).trim();
        const body = text.slice(bodyStart + 1, index);
        if (prelude.startsWith('@')) {
          // `@keyframes` bodies are percentage selectors, not rules: do not descend.
          if (!prelude.startsWith('@keyframes')) walk(body, [...atRules, prelude]);
        } else if (prelude !== '') {
          rules.push({
            selectors: splitTop(prelude, ',').map((selector) => selector.trim()),
            declarations: parseDeclarations(body),
            atRules,
          });
        }
        preludeStart = index + 1;
      }
    }
  };

  walk(withoutComments(css), []);
  return rules;
}

/**
 * What a selector's property computes to in the emitted sheet. Unlayered rules beat layered ones
 * whatever the order (CSS Cascade 5 §6.4.4); among equals, the last one wins.
 */
export async function resolved(selector: string, property: string): Promise<string | undefined> {
  const rules = parseRules(await compiledStyles()).filter(
    (rule) => rule.selectors.includes(selector) && rule.declarations.has(property),
  );
  const unlayered = rules.filter((rule) => !rule.atRules.some((at) => at.startsWith('@layer')));
  const winner = (unlayered.length > 0 ? unlayered : rules).at(-1);
  return winner?.declarations.get(property);
}

/**
 * The directories the stylesheet tells Tailwind to scan, resolved against the stylesheet's own
 * directory. `@source not` exclusions are globs, not directories, so they are not returned here.
 */
export function sourceDirectories(sheet: string): string[] {
  return [...sheet.matchAll(/@source\s+(not\s+)?['"]([^'"]+)['"]/g)]
    .filter((match) => match[1] === undefined)
    .map((match) => path.resolve(path.dirname(STYLESHEET), match[2]!));
}

/** The `@source not` globs, for a test that wants to know what is deliberately kept out. */
export function sourceExclusions(sheet: string): string[] {
  return [...sheet.matchAll(/@source\s+not\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

/** The declarations a hand-written stylesheet states for one selector, before any compilation. */
export function declarationsOf(sheet: string, selector: string): Map<string, string> | undefined {
  const rule = parseRules(sheet).find(
    (candidate) => candidate.selectors.join(', ') === selector && candidate.atRules.length === 0,
  );
  return rule?.declarations;
}
