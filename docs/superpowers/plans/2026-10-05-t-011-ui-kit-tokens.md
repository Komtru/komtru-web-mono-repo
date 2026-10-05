# T-011 UI Kit Tokens, Fonts and Brand Mark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@komtru/ui-kit` publishes the design reference's 52 `:root` custom properties as a CSS sheet and a typed record, `@komtru/config` turns them into Tailwind v4 utilities and rejects raw hex colours, and the three brand fonts plus `<KomtruMark>`/`<KomtruLogo>` come straight from the HTML.

**Architecture:** `packages/ui-kit/scripts/extract-tokens.ts` is the only thing that writes token values. It parses every `:root` block out of the reference HTML, proves they agree, and renders three generated artefacts: `packages/ui-kit/src/tokens.css`, `packages/ui-kit/src/tokens.ts` and `packages/config/tailwind/preset.css`. A parity test re-parses the HTML and the three artefacts independently and fails on any name or value difference. Everything else — fonts, brand components, the lint rule — reads the tokens rather than restating them.

**Tech Stack:** Node 22, TypeScript 6 (NodeNext, `jsx: react-jsx`), React 19, Next 15 (`next/font/google`), Tailwind CSS v4, Vitest 5 + jsdom + @testing-library/react, ESLint 9 flat config.

**Spec:** `docs/tickets/01-shared-packages.md` (T-011); source of truth `docs/design-reference/Komtru — UI Screens Living Master File.html`; consuming screens listed in `docs/design-reference/SCREEN_INDEX.md`.

## Global Constraints

- The HTML is authoritative. No value is typed by hand into `tokens.css`, `tokens.ts` or `preset.css`; all three are emitted by `extract-tokens.ts` and carry a "generated — do not edit" header.
- The HTML has five `:root` blocks (lines 9, 326, 502, 785, 989). They are byte-different only in line wrapping and declare the **same 52 properties with the same values**. The extractor must assert they agree rather than trusting the first.
- 52 is the real count and matches the ticket. 29 colours, 3 font stacks, 9 `--sp-*`, 4 `--r-*`, 2 `--shadow-*`, 4 `--dur-*`, 1 `--ease-standard`.
- No dark theme, no `prefers-color-scheme`, no `.dark` class anywhere.
- ESM with `.js` extensions on relative imports. Prettier config is `@komtru/config/prettier` (110 cols, single quotes).
- New dependencies are pinned to exact versions, matching every other `package.json` in the repo.
- `src/fonts.ts` is never re-exported from `src/index.ts`: `next/font/google` throws outside a Next build, so it is reachable only as `@komtru/ui-kit/fonts`.

## Review Focus

1. A fifth `:root` block that drifts (a value edited in one copy of the HTML only) must fail the parity test with the offending name, not be silently masked by taking the first block (Task 1 test).
2. A hand edit to `src/tokens.css` — the most likely way these files rot — must fail the parity test, not just a regeneration diff (Task 2 test).
3. `rounded-r-md` from the ticket collides with Tailwind's own `rounded-{side}` modifier: defining `--radius-r-md` makes `rounded-r-md` emit `border-radius` _and_ the two right-corner properties at once. The radius namespace must be `--radius-sm/md/lg/full` (`rounded-md` = `var(--r-md)`), and a test must prove the compiled utility carries the token (Task 3 test).
4. The hex lint rule must not fire on a URL fragment (`https://komtru.com/#abc123`) or an id that merely looks hexadecimal; it must fire on a Tailwind arbitrary value (`bg-[#4552D6]`) and on a CSS shorthand string (`1px solid #E5E9F0`) (Task 4 tests).
5. `KomtruLogo` renders in a React Server Component context, so it must not need `'use client'` and must not pull in a hook; a test renders it with no client boundary (Task 6 test).

---

### Task 1: Token extractor and the parity test

**Files:**

- Create: `packages/ui-kit/scripts/extract-tokens.ts`
- Create: `packages/ui-kit/test/tokens.test.ts`
- Modify: `packages/ui-kit/tsconfig.json` (add `scripts` to `include`)
- Modify: `packages/ui-kit/package.json` (add `"tokens": "node --experimental-strip-types scripts/extract-tokens.ts"`)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `REFERENCE_HTML: URL` — resolves `docs/design-reference/Komtru — UI Screens Living Master File.html` from the package.
  - `parseRootTokens(html: string): Map<string, string>` — returns the agreed name → value map from every `:root` block inside `<style>` elements. Declarations are split on `;` at paren/quote depth zero so `--shadow-card` survives. Throws `Error` naming the property when two blocks disagree, and when a block repeats a name.
  - `parseCssDeclarations(css: string): Map<string, string>` — same splitter, used by the test to read a generated block back.
  - `TOKEN_COUNT = 52`.
  - `renderTokensCss(tokens)`, `renderTokensTs(tokens)`, `renderTailwindPreset(tokens)` → `string` (bodies land in Tasks 2 and 3; stub them to `''` here only if needed to compile — preferred is to write Task 1's test against `parseRootTokens` alone and add the renderers in their own tasks).
  - `main()` writes the three artefacts and is invoked when the module is the entry point.

- [ ] **Step 1: Write the failing test** in `packages/ui-kit/test/tokens.test.ts`

```ts
describe('the reference HTML', () => {
  it('declares five identical :root blocks', () => {
    expect(rootBlocks(html)).toHaveLength(5);
  });

  it('declares exactly 52 custom properties', () => {
    expect(parseRootTokens(html).size).toBe(TOKEN_COUNT);
  });

  it('keeps the named token values', () => {
    const tokens = parseRootTokens(html);
    expect(tokens.get('--trust-indigo')).toBe('#4552D6');
    expect(tokens.get('--success-on-soft')).toBe('#0C6B49');
    expect(tokens.get('--font-display')).toBe("'Space Grotesk','Inter',sans-serif");
    expect(tokens.get('--sp-12')).toBe('48px');
    expect(tokens.get('--r-full')).toBe('999px');
    expect(tokens.get('--shadow-card')).toBe('0 1px 2px rgba(13,20,32,0.04), 0 4px 16px rgba(13,20,32,0.06)');
    expect(tokens.get('--dur-brand')).toBe('700ms');
    expect(tokens.get('--ease-standard')).toBe('cubic-bezier(.4,0,.2,1)');
  });

  it('introduces no dark theme', () => {
    expect(html).not.toMatch(/prefers-color-scheme|\.dark\b/);
  });
});

describe('parseRootTokens', () => {
  it('rejects blocks that disagree', () => {
    const drifted = html.replace('--trust-indigo:#4552D6', '--trust-indigo:#4552D7');
    expect(() => parseRootTokens(drifted)).toThrow(/--trust-indigo/);
  });

  it('rejects a repeated name inside one block', () => {
    expect(() => parseRootTokens('<style>:root{--a:1px;--a:2px;}</style>')).toThrow(/--a/);
  });
});
```

- [ ] **Step 2: Run `pnpm --filter @komtru/ui-kit test`** — Expected: FAIL, cannot resolve `../scripts/extract-tokens.js`.

- [ ] **Step 3: Implement the parser** in `packages/ui-kit/scripts/extract-tokens.ts`.

The splitter is the only non-obvious part: scan the block, tracking `(` depth and `'`/`"` state, cut on `;` at depth 0, then split each declaration on its first `:`. Comments explain _why_ the agreement check exists (the HTML repeats the block per section; a drifted copy is the realistic failure), not what the code does.

- [ ] **Step 4: Run `pnpm --filter @komtru/ui-kit test`** — Expected: PASS, 6 tests.

- [ ] **Step 5: Commit** `feat(ui-kit): parse the reference HTML's root tokens`

---

### Task 2: `tokens.css` and `tokens.ts`

**Files:**

- Create: `packages/ui-kit/src/tokens.css` (generated), `packages/ui-kit/src/tokens.ts` (generated)
- Modify: `packages/ui-kit/scripts/extract-tokens.ts` (`renderTokensCss`, `renderTokensTs`, `main`)
- Modify: `packages/ui-kit/test/tokens.test.ts`
- Modify: `packages/ui-kit/package.json` (`exports["./tokens.css"] → "./src/tokens.css"`; `files`/`main` unchanged)

**Interfaces:**

- Consumes: `parseRootTokens`, `parseCssDeclarations`, `TOKEN_COUNT` (Task 1).
- Produces:
  - `src/tokens.css`: a header comment, then one `:root { … }` block with all 52 properties in HTML order, one per line.
  - `src/tokens.ts`: `KOMTRU_TOKENS` — `as const satisfies Record<string, string>` object keyed by the literal token names; `type KomtruTokenName = keyof typeof KOMTRU_TOKENS`; `cssVar(name: KomtruTokenName): string` returning `` `var(${name})` ``. File opens with `/* eslint-disable komtru/no-raw-hex -- generated from the design reference; this is where the palette lives. */`.

- [ ] **Step 1: Write the failing test** (append to `test/tokens.test.ts`)

```ts
describe('generated artefacts', () => {
  it('tokens.css declares exactly the HTML tokens', () => {
    expect(parseCssDeclarations(readArtefact('src/tokens.css'))).toEqual(parseRootTokens(html));
  });

  it('tokens.ts exports exactly the HTML tokens', () => {
    expect(new Map(Object.entries(KOMTRU_TOKENS))).toEqual(parseRootTokens(html));
  });

  it('is byte-identical to a fresh render', () => {
    expect(readArtefact('src/tokens.css')).toBe(renderTokensCss(parseRootTokens(html)));
    expect(readArtefact('src/tokens.ts')).toBe(renderTokensTs(parseRootTokens(html)));
  });

  it('cssVar quotes a token for inline use', () => {
    expect(cssVar('--trust-emerald')).toBe('var(--trust-emerald)');
  });
});
```

`readArtefact` reads relative to the package root via `new URL(..., import.meta.url)`.

- [ ] **Step 2: Run `pnpm --filter @komtru/ui-kit test`** — Expected: FAIL, `src/tokens.css` does not exist.

- [ ] **Step 3: Implement `renderTokensCss` and `renderTokensTs` and `main`, then run `pnpm --filter @komtru/ui-kit tokens`** to write the artefacts. Run `pnpm exec prettier --write packages/ui-kit/src/tokens.css packages/ui-kit/src/tokens.ts` once, then make the renderers emit exactly what Prettier accepts so `prettier --check` and the byte-identity test agree.

- [ ] **Step 4: Run `pnpm --filter @komtru/ui-kit test`** — Expected: PASS, 10 tests. Run `pnpm exec prettier --check packages/ui-kit` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ui-kit): generate tokens.css and tokens.ts from the reference`

---

### Task 3: Tailwind v4 preset

**Files:**

- Create: `packages/config/tailwind/preset.css` (generated)
- Create: `packages/config/test/tailwind-preset.test.ts`
- Modify: `packages/ui-kit/scripts/extract-tokens.ts` (`renderTailwindPreset`)
- Modify: `packages/ui-kit/test/tokens.test.ts` (parity over the preset)
- Modify: `packages/config/package.json` (`exports["./tailwind/preset.css"]`, devDependency `tailwindcss`)

**Interfaces:**

- Consumes: `parseRootTokens`, `parseCssDeclarations` (Task 1).
- Produces: `packages/config/tailwind/preset.css`, the single stylesheet every app imports. Structure, in order:
  1. generated header comment;
  2. `@import 'tailwindcss';`
  3. `@theme { … }` — the 6 tokens whose Tailwind namespace name is already the HTML name: `--font-display`, `--font-body`, `--font-mono`, `--shadow-card`, `--shadow-raised`, `--ease-standard`. Declaring them here both publishes the custom property and creates `font-display`, `shadow-card`, `ease-standard`. They must **not** also appear in the `:root` block below, and must **not** be aliased in `@theme inline` — a custom property that references itself is invalid at computed-value time.
  4. `:root { … }` — the other 46 tokens, verbatim.
  5. `@theme inline { … }` — the Tailwind namespace aliases, each `var(--<html name>)`: `--color-<name>` for all 29 colours, `--spacing-1/2/3/4/5/6/8/10/12` from `--sp-*`, `--radius-sm/md/lg/full` from `--r-*`. `inline` keeps the utility pointing at the HTML token. The 4 `--dur-*` tokens get no alias: Tailwind v4 has no duration namespace, so they are consumed as `var(--dur-standard)` or `duration-[var(--dur-standard)]`.

- [ ] **Step 1: Write the failing tests.**

In `packages/ui-kit/test/tokens.test.ts`:

```ts
it('the tailwind preset declares exactly the HTML tokens', () => {
  const preset = readPreset(); // packages/config/tailwind/preset.css
  const declared = new Map([
    ...parseCssDeclarations(blockOf(preset, '@theme {')),
    ...parseCssDeclarations(blockOf(preset, ':root {')),
  ]);
  expect(declared).toEqual(parseRootTokens(html));
});

it('aliases every non-namespaced token and never self-references', () => {
  const aliases = parseCssDeclarations(blockOf(readPreset(), '@theme inline {'));
  expect(aliases.get('--color-trust-indigo')).toBe('var(--trust-indigo)');
  expect(aliases.get('--spacing-4')).toBe('var(--sp-4)');
  expect(aliases.get('--radius-md')).toBe('var(--r-md)');
  expect(aliases.has('--radius-r-md')).toBe(false);
  for (const [name, value] of aliases) expect(value).not.toBe(`var(${name})`);
});

it('the preset is byte-identical to a fresh render', () => {
  expect(readPreset()).toBe(renderTailwindPreset(parseRootTokens(html)));
});
```

In `packages/config/test/tailwind-preset.test.ts`, compile the preset with `compile()` from `tailwindcss` (a `loadStylesheet` that resolves `tailwindcss` → `tailwindcss/index.css` via `createRequire`), build the candidate list and assert on the emitted CSS:

```ts
it('maps tokens onto utilities', async () => {
  const css = await build([
    'bg-trust-indigo',
    'text-slate',
    'p-4',
    'rounded-md',
    'font-display',
    'shadow-card',
    'ease-standard',
  ]);
  expect(css).toContain('.bg-trust-indigo {\n    background-color: var(--trust-indigo);');
  expect(css).toContain('.p-4 {\n    padding: var(--sp-4);');
  expect(css).toContain('.rounded-md {\n    border-radius: var(--r-md);');
  expect(css).toContain('font-family: var(--font-display)');
});

it('publishes every HTML token as a custom property', async () => {
  const css = await build([]);
  expect(css).toContain('--trust-emerald: #159768;');
  expect(css).toContain('--dur-trust: 400ms;');
});

it('introduces no dark theme', async () => {
  expect(await build(['bg-trust-indigo'])).not.toMatch(/prefers-color-scheme|\.dark\b/);
});
```

- [ ] **Step 2: Run `pnpm --filter @komtru/ui-kit test` and `pnpm --filter @komtru/config test`** — Expected: both FAIL, `preset.css` missing / `tailwindcss` not installed.

- [ ] **Step 3: Add `tailwindcss` to `@komtru/config` devDependencies (exact version), implement `renderTailwindPreset`, regenerate with `pnpm --filter @komtru/ui-kit tokens`.**

- [ ] **Step 4: Run both test commands** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(config): map the design tokens onto tailwind v4 utilities`

---

### Task 4: `komtru/no-raw-hex` lint rule

**Files:**

- Create: `packages/config/eslint/no-raw-hex.mjs`, `packages/config/eslint/no-raw-hex.d.mts`
- Create: `packages/config/test/eslint/no-raw-hex.test.ts`
- Modify: `packages/config/eslint/index.mjs`, `packages/config/eslint/index.d.mts`

**Interfaces:**

- Consumes: nothing.
- Produces: default-exported `Rule.RuleModule`. `meta.type: 'problem'`, `messages.rawHex`: `"Use a design token ('bg-trust-indigo', var(--trust-indigo)), not the raw colour '{{hex}}'."`, `schema` with one options object `{ allow?: string[] }` (case-insensitive). Checks `Literal` string values and `TemplateElement` cooked values. A match is `#` followed by 3, 4, 6 or 8 hex digits, not preceded by a word character or `/`, not followed by a word character; a string containing `://` is skipped, because a URL fragment is the one realistic false positive. `komtruEslint` registers it as `plugins: { komtru: { rules: { 'no-raw-hex': noRawHex } } }` with `'komtru/no-raw-hex': 'error'` for every workspace, so apps get it without opting in. `komtruEslint` passes the rule no options; the one file that must carry hex (the generated `tokens.ts`) uses an `eslint-disable` comment.

- [ ] **Step 1: Write the failing test** in `packages/config/test/eslint/no-raw-hex.test.ts`, modelled on `apps/backend-api/test/eslint/pgbouncer-safe.test.ts` (`RuleTester` wired to Vitest, `tseslint.parser`).

```ts
valid: [
  "const c = 'var(--trust-indigo)';",
  "const cls = 'bg-trust-indigo';",
  "const url = 'https://komtru.com/docs#abc123';",
  "const sha = 'deadbeef';",
  "const anchor = '#pricing';",
  "const id = '#hub-004';",
  "const long = '#0123456789';",
  { code: "const c = '#FFFFFF';", options: [{ allow: ['#ffffff'] }] },
],
invalid: [
  rawHex("const c = '#4552D6';", '#4552D6'),
  rawHex("const c = '#fff';", '#fff'),
  rawHex("const s = '1px solid #E5E9F0';", '#E5E9F0'),
  rawHex('const cls = `bg-[#4552D6]`;', '#4552D6'),
  rawHex("const cls = 'text-[#0D1420] bg-[#F5F7FA]';", '#0D1420', '#F5F7FA'), // two reports
  rawHex("const c = '#0D142080';", '#0D142080'),
],
```

Also add to `packages/config/test/eslint.test.ts` an assertion that the rule arrives through `komtruEslint`: a fixture `test/fixtures/raw-hex.ts` containing `export const brand = '#4552D6';` lints to `['komtru/no-raw-hex']`.

- [ ] **Step 2: Run `pnpm --filter @komtru/config test`** — Expected: FAIL, module not found.

- [ ] **Step 3: Implement the rule and register it in `komtruEslint`.** The header comment says why the rule exists (every colour in the product is one of the reference's 52; a hex in app code is a design-system escape) and why `://` is skipped.

- [ ] **Step 4: Run `pnpm --filter @komtru/config test` and `pnpm exec turbo run lint --force`** — Expected: PASS; in particular `@komtru/ui-kit` lint must pass with the generated `tokens.ts` and its disable comment.

- [ ] **Step 5: Commit** `feat(config): reject raw hex colours in app code`

---

### Task 5: `next/font` loaders

**Files:**

- Create: `packages/ui-kit/src/fonts.ts`
- Create: `packages/ui-kit/test/fonts.test.ts`
- Modify: `packages/ui-kit/package.json` (`exports["./fonts"]`; `next`, `react`, `react-dom` as peer + dev dependencies), `packages/ui-kit/tsconfig.json` / `tsconfig.build.json` (`jsx: react-jsx`, `types` gains nothing — `next` ships its own)

**Interfaces:**

- Consumes: `KOMTRU_TOKENS` (Task 2) — only in the test, to prove the fallbacks match.
- Produces, from `next/font/google`:
  - `displayFont` — `Space_Grotesk({ subsets: ['latin'], weight: ['400','500','600','700'], variable: '--font-display', fallback: ['Inter', 'sans-serif'], display: 'swap' })`
  - `bodyFont` — `Inter({ subsets: ['latin'], variable: '--font-body', fallback: ['-apple-system', 'sans-serif'], display: 'swap' })`
  - `monoFont` — `IBM_Plex_Mono({ subsets: ['latin'], weight: ['400','500','600'], variable: '--font-mono', fallback: ['SFMono-Regular', 'monospace'], display: 'swap' })`
  - `fontVariables: string` — the three `.variable` class names joined by a space, for `<html className={fontVariables}>`.

`next/font/google` is a build-time construct and throws when imported in Node, so the test asserts against the module's **source text**, not its exports.

- [ ] **Step 1: Write the failing test** in `packages/ui-kit/test/fonts.test.ts`

```ts
const source = readFileSync(new URL('../src/fonts.ts', import.meta.url), 'utf8');

const fallbacksOf = (token: string) =>
  KOMTRU_TOKENS[token].split(',').map((part) => part.trim().replace(/^'|'$/g, ''));

it.each([
  ['--font-display', 'Space_Grotesk', '--font-display'],
  ['--font-body', 'Inter', '--font-body'],
  ['--font-mono', 'IBM_Plex_Mono', '--font-mono'],
])('loads %s through next/font with the HTML fallbacks', (token, loader, variable) => {
  const [family, ...fallback] = fallbacksOf(token);
  expect(loader.replaceAll('_', ' ')).toBe(family);
  expect(source).toContain(`variable: '${variable}'`);
  expect(source).toContain(`fallback: [${fallback.map((f) => `'${f}'`).join(', ')}]`);
});

it('exports the three variable class names together', () => {
  expect(source).toMatch(
    /fontVariables[\s\S]*displayFont\.variable[\s\S]*bodyFont\.variable[\s\S]*monoFont\.variable/,
  );
});

it('is not re-exported from the package root', () => {
  expect(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')).not.toContain('fonts.js');
});
```

- [ ] **Step 2: Run `pnpm --filter @komtru/ui-kit test`** — Expected: FAIL, `src/fonts.ts` does not exist.

- [ ] **Step 3: Install `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom` (exact versions) in `@komtru/ui-kit`; write `src/fonts.ts`.** One comment explains why the module is a separate export: importing it outside a Next build throws.

- [ ] **Step 4: Run `pnpm --filter @komtru/ui-kit test typecheck build`** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ui-kit): load the brand fonts through next/font`

---

### Task 6: `KomtruMark` and `KomtruLogo`

**Files:**

- Create: `packages/ui-kit/src/brand/KomtruMark.tsx`, `packages/ui-kit/src/brand/KomtruLogo.tsx`, `packages/ui-kit/src/brand/index.ts`
- Create: `packages/ui-kit/test/brand.test.tsx`
- Modify: `packages/ui-kit/src/index.ts` (replace the placeholder export), `packages/ui-kit/test/index.test.ts`, `packages/ui-kit/vitest.config.ts` (jsdom, `.tsx` tests), `packages/ui-kit/package.json` (`@testing-library/react`, `jsdom`)

**Interfaces:**

- Consumes: `cssVar` (Task 2).
- Produces:
  - `KomtruMarkProps = { size?: number; nodeRadius?: 2.2 | 2.3; title?: string; className?: string }`.
    `KomtruMark({ size = 16, nodeRadius = 2.2, title, className })` → the literal reference SVG: `viewBox="0 0 24 24"`, `fill="none"`, `stroke={cssVar('--trust-emerald')}`, `strokeWidth={2}`, `strokeLinecap="round"`, `width`/`height` = `size`, three `<circle>` at `(6,12)`, `(18,6)`, `(18,18)` with `r={nodeRadius}`, and `<path d="M8 11l8-4M8 13l8 4" />`. With no `title`, `aria-hidden="true"` and `focusable="false"`; with a `title`, `role="img"` and a `<title>` child.
    `nodeRadius` exists because the reference draws the node circles at `r=2.2` beside the word "Komtru" and `r=2.3` beside "Komtru Ops"; the union type keeps it to the two values the HTML actually uses.
  - `KomtruLogoProps = { product?: 'ops'; size?: number; className?: string }`.
    `KomtruLogo({ product, size, className })` → a `<span>` with `display:inline-flex; align-items:center`, `fontFamily: cssVar('--font-display')`, `fontWeight: 600`, containing `<KomtruMark>` and the wordmark text. Consumer (`.scr-logo`): text `Komtru`, `fontSize: 14`, `gap: 6`, mark size 16, `nodeRadius` 2.2. Ops (`.ds-logo`, `product="ops"`): text `Komtru Ops`, `fontSize: 13`, `gap: 7`, mark size 16, `nodeRadius` 2.3. An explicit `size` overrides the mark size only.
  - `src/brand/index.ts` re-exports both components and both prop types; `src/index.ts` re-exports `./brand/index.js` and `./tokens.js` and drops the `workspace` placeholder.

- [ ] **Step 1: Write the failing test** in `packages/ui-kit/test/brand.test.tsx`

```tsx
it('draws the reference mark', () => {
  const { container } = render(<KomtruMark />);
  const svg = container.querySelector('svg')!;
  expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  expect(svg.getAttribute('fill')).toBe('none');
  expect(svg.getAttribute('stroke')).toBe('var(--trust-emerald)');
  expect(svg.getAttribute('stroke-width')).toBe('2');
  expect(svg.getAttribute('stroke-linecap')).toBe('round');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(
    [...svg.querySelectorAll('circle')].map((c) => [
      c.getAttribute('cx'),
      c.getAttribute('cy'),
      c.getAttribute('r'),
    ]),
  ).toEqual([
    ['6', '12', '2.2'],
    ['18', '6', '2.2'],
    ['18', '18', '2.2'],
  ]);
  expect(svg.querySelector('path')!.getAttribute('d')).toBe('M8 11l8-4M8 13l8 4');
});

it('becomes an image when given a title', () => {
  render(<KomtruMark title="Komtru" />);
  expect(screen.getByRole('img', { name: 'Komtru' })).toBeDefined();
});

it('renders the consumer wordmark', () => {
  const { container } = render(<KomtruLogo />);
  expect(container.textContent).toBe('Komtru');
  expect(container.firstElementChild).toHaveStyle({ fontFamily: 'var(--font-display)', fontWeight: '600' });
  expect(container.querySelector('circle')!.getAttribute('r')).toBe('2.2');
});

it('renders the ops wordmark with the reference node radius', () => {
  const { container } = render(<KomtruLogo product="ops" />);
  expect(container.textContent).toBe('Komtru Ops');
  expect(container.querySelector('circle')!.getAttribute('r')).toBe('2.3');
});

it('needs no client boundary', () => {
  for (const file of ['KomtruMark.tsx', 'KomtruLogo.tsx'])
    expect(readFileSync(new URL(`../src/brand/${file}`, import.meta.url), 'utf8')).not.toContain(
      'use client',
    );
});

it('matches the markup the reference writes for .scr-logo and .ds-logo', () => {
  // the two reference snippets, read out of the HTML and compared attribute by attribute
  expect(markAttributesFromHtml('scr-logo')).toEqual(markAttributes(render(<KomtruLogo />).container));
  expect(markAttributesFromHtml('ds-logo', 'Komtru Ops')).toEqual(
    markAttributes(render(<KomtruLogo product="ops" />).container),
  );
});
```

- [ ] **Step 2: Run `pnpm --filter @komtru/ui-kit test`** — Expected: FAIL, components do not exist.

- [ ] **Step 3: Install `@testing-library/react` and `jsdom` (exact versions), set `environment: 'jsdom'` and a `.tsx`-aware `include` in `packages/ui-kit/vitest.config.ts`, implement the two components and the barrels.**

- [ ] **Step 4: Run `pnpm --filter @komtru/ui-kit test typecheck build lint`** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ui-kit): add the komtru mark and logo from the reference`

---

### Task 7: Verify and close the ticket

**Files:**

- Modify: `docs/tickets/01-shared-packages.md` (T-011 status)

- [ ] **Step 1: Run `pnpm exec turbo run build lint typecheck test --force`** — Expected: all tasks successful; record the test counts.

- [ ] **Step 2: Run `pnpm exec prettier --check .`** — Expected: "All matched files use Prettier code style!".

- [ ] **Step 3: Add the status lines** under `### T-011 — \`ui-kit\` tokens, fonts and brand mark`:

```markdown
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-011-ui-kit-tokens.md`.
- **Deferred:** …
```

The `Deferred` line records the two deviations from the ticket's wording: the radius utilities are `rounded-sm/md/lg/full` (not `rounded-r-md`, which collides with Tailwind's side modifier), and `--dur-*` has no Tailwind namespace so durations stay as plain custom properties.

- [ ] **Step 4: Commit** `docs(tickets): mark T-011 done`

- [ ] **Step 5: Request a fresh code review of the whole branch against `main`, triage the findings, then re-run Step 1 and Step 2.**
