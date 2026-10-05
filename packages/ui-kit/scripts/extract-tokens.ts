// Reads the design reference's `:root` custom properties and writes every token artefact in the
// repo from them. Nothing downstream may type a colour, a spacing step or a shadow by hand: the
// HTML is the design system, and `test/tokens.test.ts` re-parses it to prove these files still agree.

const REFERENCE_FILE = 'Komtru — UI Screens Living Master File.html';

/** The reference HTML, resolved from this package rather than the caller's working directory. */
export const REFERENCE_HTML = new URL(`../../../docs/design-reference/${REFERENCE_FILE}`, import.meta.url);

/** The number of custom properties the reference declares. The ticket's count, confirmed. */
export const TOKEN_COUNT = 52;

/**
 * Splits a declaration list on `;`, ignoring semicolons nested in parentheses or quotes. A naive
 * `split(';')` happens to work today but would cut `--shadow-card` in half the moment someone adds
 * a value containing one, which is exactly the silent corruption this file exists to prevent.
 */
function splitDeclarations(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ';' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Parses a `{ … }` body into name → value. Throws on a repeated name, which in a generated file
 * means the renderer emitted a token twice.
 */
export function parseCssDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of splitDeclarations(body)) {
    const colon = declaration.indexOf(':');
    if (colon === -1) throw new Error(`Declaration without a value: ${declaration}`);
    const name = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (declarations.has(name)) throw new Error(`Duplicate custom property ${name}`);
    declarations.set(name, value);
  }
  return declarations;
}

/** The body of every `:root { … }` rule inside a `<style>` element, in document order. */
export function rootBlocks(html: string): string[] {
  const bodies: string[] = [];
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const block of (style[1] ?? '').matchAll(/:root\s*\{([^}]*)\}/g)) {
      bodies.push(block[1] ?? '');
    }
  }
  return bodies;
}

/**
 * The tokens all `:root` blocks agree on. The reference repeats the block once per section it was
 * assembled from, so a value edited in only one copy is the realistic way the design system drifts;
 * comparing the blocks catches that instead of silently preferring the first one.
 */
export function parseRootTokens(html: string): Map<string, string> {
  const blocks = rootBlocks(html);
  if (blocks.length === 0) throw new Error('The reference HTML declares no :root block');

  const [first, ...rest] = blocks;
  const tokens = parseCssDeclarations(first ?? '');

  for (const [index, block] of rest.entries()) {
    const other = parseCssDeclarations(block);
    for (const [name, value] of tokens) {
      const found = other.get(name);
      if (found === undefined) throw new Error(`:root block ${index + 2} is missing ${name}`);
      if (found !== value) {
        throw new Error(`:root block ${index + 2} sets ${name} to ${found}, not ${value}`);
      }
    }
    for (const name of other.keys()) {
      if (!tokens.has(name)) throw new Error(`:root block ${index + 2} adds ${name}`);
    }
  }

  return tokens;
}
