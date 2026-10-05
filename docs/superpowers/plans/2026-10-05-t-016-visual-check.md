# T-016 Visual-Check Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm visual-check --screen U4 --url http://localhost:3004/handover/KMT-88213` screenshots the reference screen and the built screen at the same width, and writes `docs/ui-review/<ticket>/<screen>.png` (reference | built | heat map), `<screen>.diff.png` and a `<screen>.md` deviation stub. A flagged pixel means a real deviation — not a font the reference never shipped.

**Architecture:** `tools/visual-check` becomes a workspace package (`@komtru/visual-check`) so turbo lints, typechecks and tests it like everything else; the root `visual-check` script runs its CLI with `node --experimental-strip-types`. The pipeline is four pure stages and one browser stage: locate the screen in `SCREEN_INDEX.md` → carve it out of the reference HTML into a standalone document → screenshot both sides in one Chromium with one injected font stylesheet → pixel-diff and compose. Everything except the browser stage is a pure function over strings and buffers, and is tested as one.

**Tech Stack:** Node 22 (`--experimental-strip-types`), TypeScript 6 strict, ESM with `.js` extensions, Playwright 1.63.0 (already pinned at the root), `pixelmatch` + `pngjs`, Fontsource webfonts, Vitest 5.

**Spec:** `docs/tickets/01-shared-packages.md` (T-016); `docs/design-reference/SCREEN_INDEX.md`; `docs/design-reference/Komtru — UI Screens Living Master File.html`.

## The three decisions this ticket makes

### 1. Fonts — ship the real typefaces and inject them into both pages

`tokens.css` names `'Space Grotesk'`, `'Inter'` and `'IBM Plex Mono'` and ships no `@font-face`; T-011 recorded this as a known gap. Left alone, the reference renders in Helvetica and the built app in next/font's self-hosted Google files, and _every_ diff would be a wall of typography noise that buries the real deviations.

Options considered:

- **Mask text regions.** Rejected: most deviations in a design-system build _are_ text — wrong size, wrong weight, wrong tracking, wrong colour. Masking throws away the signal to remove the noise.
- **Link a webfont stylesheet (Google Fonts) at screenshot time.** Rejected: a network round-trip inside a screenshot tool makes the diff non-deterministic and non-reproducible offline, and the upstream file can change without the repository changing.
- **Chosen: install the three families as exact-pinned dependencies and inline them as `@font-face` into both pages.** `@fontsource-variable/space-grotesk`, `@fontsource-variable/inter` and `@fontsource/ibm-plex-mono` ship the same Google-generated `latin` WOFF2 files that `next/font/google` self-hosts in the apps, so both sides render the same outlines at the same metrics. The files are dependencies, not committed binaries; the harness reads them from `node_modules`, base64s them into a `<style>` block with `font-display: block`, and waits on `document.fonts.ready` before shooting. Deterministic, offline, and — crucially — a built screen that uses the _wrong_ family still differs, because both sides have all three families available and only the markup decides which one applies.

Animations and transitions are disabled and the caret is made transparent in both pages for the same reason: a flagged pixel must mean a deviation, not a frame of a transition.

### 2. Reference rendering — carve the screen into a standalone document

The alternative, rendering all 9,181 lines and cropping, was rejected for one reason: the gallery's own layout decides the screen's width. `.screen-row` is a horizontally scrolling flexbox and `.screen-unit` carries inline widths like `calc(50% - 9px)`, so a cropped screenshot is the width of the _gallery_, not of the frame. It is also several seconds and a few hundred MB per run.

The carve keeps everything the screen depends on:

- **All eleven `<style>` elements**, in document order, including the five `:root` blocks. The later sheets (`komtru-unified-ds-v4`, `p2-canonical-ui`, `p3-proportion-fix-v8`) override the earlier ones, so taking fewer than all of them silently renders an older design.
- **The ancestor chain.** `#p3-canonical` scopes eighteen rules that set the Part 3 screens' geometry; a screen lifted out of its section loses them. The carve replays every open tag from `<body>` down to the frame, tagged `data-komtru-vc="ancestor"`, and a harness sheet flattens those ancestors' own layout (`display:block`, no width, no padding, no overflow) without touching their identity.
- **Not** the `.screen-num` header: it is the gallery's caption, not the screen.

### 3. Widths — the four the reference declares

The reference states its own geometry, in CSS and in a comment on `#p3-proportion-fix-v8`: "desktop 1040px max, tablet 560px fixed".

| Reference frame                | Device  | Width | Declared by                                        |
| ------------------------------ | ------- | ----- | -------------------------------------------------- |
| `.mweb-frame` (150 screens)    | mobile  | 340   | `.mweb-frame{width:340px}`                         |
| `.device.phone` (1 screen, P1) | mobile  | 230   | `.device.phone{width:230px}`                       |
| `.dweb-frame.tablet` (5)       | tablet  | 560   | `.dweb-frame.tablet{width:560px}`                  |
| `.p2-browser.p2-tablet` (4)    | tablet  | 560   | `#p3-canonical .p2-browser.p2-tablet{width:560px}` |
| `.dweb-frame.desktop` (39)     | desktop | 1040  | `.dweb-frame.desktop{max-width:1040px}`            |
| `.p2-browser` (11)             | desktop | 1040  | `#p3-canonical .p2-browser{max-width:1040px}`      |

Those are the six frames the 210 screens use — all of them. The widths are **re-parsed from the reference CSS** with T-011's `parseCssDeclarations`, never typed into the harness, and a test fails if the reference changes one.

The carved page is rendered at the gallery's own 1280px, not at the frame's width, and the frame is pinned to its declared width in CSS. The reference carries `@media(max-width:900px)` and `@media(max-width:640px)` rules from the design system it was assembled from; at a 560px viewport those fire and redraw a tablet screen as something the reference never shows. The built page, of course, gets a viewport of exactly the compared width — its media queries are the thing under test.

The frame's device chrome — the fake browser bezel, the border, the radius, the shadow — is a drawing of a browser, not part of the screen, so the harness removes the border, radius and shadow and clips to the frame's children _other than_ `.mweb-chrome`/`.dweb-chrome`. Removing the 1px border is what makes the clip exactly 340 (or 560, or 1040) wide rather than 338, so the built app is given exactly the width the reference declares. The built page's viewport is set to that clip's size, so the two PNGs are the same shape by construction and pixelmatch never has to be told what to do about a size mismatch.

## Global Constraints

- Do not touch `apps/backend-api`, Docker, or `KOMTRU_INFRA_TESTS`. Nine agents share this checkout's services.
- Anything that launches a browser is gated on `KOMTRU_BROWSER_TESTS=1`, exactly as `scripts/test/playwright-browser.test.ts` is, so a fresh checkout without browsers stays green.
- New dependencies are pinned to exact versions, no `^`.
- ESM and TypeScript 6 strict with `noUncheckedIndexedAccess`. Relative imports carry `.ts`, not the repo's usual `.js`: this package is never compiled, it runs from source under `node --experimental-strip-types`, and Node resolves the file on disk rather than rewriting the extension. `allowImportingTsExtensions` with `noEmit` is the matching tsconfig.
- Comments explain _why_. Match the voice of `scripts/test/screen-index.test.ts` and `packages/ui-kit/scripts/extract-tokens.ts`.
- The PNGs are **not** committed. They are per-run review artefacts of a page that changes every commit, and three PNGs per screen across 210 screens is a permanent cost for a transient read. `.gitignore` gets `docs/ui-review/**/*.png`; the `<screen>.md` deviation stubs _are_ committed, because the deviation list is the durable half of the review and diffs as text.

## Review Focus

1. The ancestor chain must survive the carve: a Part 3 screen (`P3-D1`) carved without `#p3-canonical` renders at the wrong geometry and nothing fails. There is a test that asserts the ancestor ids come along.
2. The injected font stylesheet must cover **both** pages, not just the reference. If only the reference gets it the problem is inverted, not solved.
3. The clip must exclude the mock browser chrome. If `.mweb-chrome` is in the reference shot, every mobile screen has a 30px band of guaranteed deviation at the top.
4. The widths must come from the reference CSS. A hand-typed `340` passes every test on day one and rots silently.
5. The two PNGs must be identical in size before pixelmatch sees them; pixelmatch throws on a mismatch, and "throws" is a worse failure mode than a clear message naming both sizes.
6. `TO-PA10` appears twice in `SCREEN_INDEX.md` (the index header says so). The locator must not silently pick one.

---

### Task 1: The workspace package and the screen locator

**Files:**

- Create: `tools/visual-check/package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`
- Create: `tools/visual-check/src/screen-index.ts`
- Create: `tools/visual-check/test/screen-index.test.ts`
- Modify: `pnpm-workspace.yaml` (add `tools/*`), `packages/ui-kit/package.json` (export `./extract-tokens`)

**Interfaces:**

- Produces:
  - `REFERENCE_DIR: URL`, `REFERENCE_HTML_PATH: URL`, `SCREEN_INDEX_PATH: URL` — resolved from the package, not the working directory.
  - `interface ScreenRow { id; screen; section; line; app; ticket }`.
  - `parseScreenIndex(markdown: string): ScreenRow[]` — the six columns, line as a number.
  - `findScreen(rows, id): ScreenRow` — throws naming the id when it is unknown, and throws when the id is ambiguous (`TO-PA10`) telling the caller to pass `--line`.
  - `loadScreens(): ScreenRow[]` — reads `SCREEN_INDEX.md`.

`tools/*` in `pnpm-workspace.yaml` picks up only directories with a `package.json`, so `tools/tickets` (Python) is unaffected. Making this a workspace package is what gets it into `turbo run lint typecheck test` and therefore into the `repo` workflow's "Every workspace package" job; the root `visual-check` script still runs the CLI by path, which resolves its dependencies from `tools/visual-check/node_modules`.

`packages/ui-kit` gains one export, `"./extract-tokens": "./scripts/extract-tokens.ts"`, so this package can use `parseCssDeclarations` and `REFERENCE_FILE` instead of writing a second CSS parser. It points at the source because `tsconfig.build.json` only emits `src`, and the package already exports a source file this way (`"./tokens.css"`). **Verify this import resolves under both `node --experimental-strip-types` and Vitest in Step 2; if it does not, keep the ui-kit `package.json` untouched and re-export the two helpers from a thin local module with a comment saying why.**

- [ ] **Step 1: Write the failing test** in `tools/visual-check/test/screen-index.test.ts`

```ts
it('parses every row of the index', () => {
  const rows = loadScreens();
  expect(rows).toHaveLength(210);
  expect(rows[0]).toEqual({
    id: 'E1',
    screen: 'Welcome',
    section: 'Entry — Mobile Web',
    line: 1945,
    app: 'web-app-ui',
    ticket: 'T-111',
  });
});

it('finds a screen by id', () => {
  expect(findScreen(loadScreens(), 'P2-D1')).toMatchObject({
    line: 3061,
    app: 'web-app-ui',
    ticket: 'T-113',
  });
});

it('names the id it cannot find', () => {
  expect(() => findScreen(loadScreens(), 'NOPE')).toThrow(/NOPE/);
});

it('refuses the one id the reference shows twice', () => {
  expect(() => findScreen(loadScreens(), 'TO-PA10')).toThrow(/TO-PA10.*--line/s);
});
```

- [ ] **Step 2: `pnpm install` then `pnpm --filter @komtru/visual-check test`** — Expected: FAIL, module not found. Also run `node --experimental-strip-types -e "import('@komtru/visual-check/…')"`-equivalent check that `import { parseCssDeclarations } from '@komtru/ui-kit/extract-tokens'` resolves in both runtimes.

- [ ] **Step 3: Implement** `src/screen-index.ts`, reusing the row shape `scripts/test/screen-index.test.ts` already proves.

- [ ] **Step 4: `pnpm --filter @komtru/visual-check test lint typecheck`** — Expected: PASS, 4 tests.

- [ ] **Step 5: Commit** `feat(visual-check): locate a reference screen from SCREEN_INDEX.md`

---

### Task 2: Frames, and carving one screen out of the reference

**Files:**

- Create: `tools/visual-check/src/frames.ts`, `tools/visual-check/src/reference.ts`
- Create: `tools/visual-check/test/frames.test.ts`, `tools/visual-check/test/reference.test.ts`

**Interfaces:**

- `frames.ts`
  - `type Device = 'mobile' | 'tablet' | 'desktop'`.
  - `FRAMES: readonly { classes: string[]; device: Device; widthFrom: { selector: string; property: 'width' | 'max-width' } }[]` — the six rows of the table above, in most-specific-first order so `p2-browser p2-tablet` wins over `p2-browser`.
  - `frameWidths(html: string): Record<Device, number>` — reads each `widthFrom` rule out of the reference's `<style>` blocks with `parseCssDeclarations` and returns `{ mobile: 340, tablet: 560, desktop: 1040 }`; `.device.phone` is its own entry at 230. Throws naming the selector when the rule is gone.
  - `matchFrame(classAttribute: string)` → the row, or null.
- `reference.ts`
  - `styleBlocks(html: string): string[]` — the eleven `<style …>…</style>` elements, verbatim with their tags.
  - `openElements(html, index): { tag, attributes, classes, id }[]` — one linear scan from the top of the document, returning the stack of elements open at `index`. Handles comments, void elements and the reference's self-closing SVG children.
  - `carveScreen(html, row): { document: string; device: Device; width: number; frameSelector: string }` — the standalone document.

The carved document is: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` + every `<style>` block + the harness sheet + `</head>` + the replayed ancestor open tags (each with `data-komtru-vc="ancestor"`) + the frame element's own markup + the closing tags. The harness sheet flattens the ancestors, strips the frame's border/radius/shadow, and stops animation.

- [ ] **Step 1: Write the failing tests.**

```ts
// frames.test.ts
it('reads the three widths out of the reference CSS', () => {
  expect(frameWidths(html)).toEqual({ mobile: 340, tablet: 560, desktop: 1040 });
});

it('fails loudly when the reference stops declaring one', () => {
  expect(() => frameWidths(html.replace('.mweb-frame{width:340px;', '.mweb-frame{'))).toThrow(/mweb-frame/);
});

it('prefers the tablet variant over the bare browser frame', () => {
  expect(matchFrame('p2-browser p2-tablet')?.device).toBe('tablet');
  expect(matchFrame('p2-browser')?.device).toBe('desktop');
});

it('classifies every screen in the index', () => {
  for (const row of loadScreens()) expect(carveScreen(html, row).device).toBeTruthy();
});

// reference.test.ts
it('keeps every stylesheet, including all five :root blocks', () => {
  const { document } = carveScreen(html, findScreen(rows, 'E1'));
  expect(styleBlocks(document).length).toBeGreaterThanOrEqual(styleBlocks(html).length);
  expect(rootBlocks(document)).toHaveLength(5);
});

it('replays the ancestor chain so section-scoped CSS still applies', () => {
  const { document } = carveScreen(html, findScreen(rows, 'P3-D1'));
  expect(document).toContain('id="p3-canonical"');
  expect(document).toContain('data-komtru-vc="ancestor"');
});

it('carves the frame and drops the gallery caption', () => {
  const { document, width, device } = carveScreen(html, findScreen(rows, 'E1'));
  expect(device).toBe('mobile');
  expect(width).toBe(340);
  expect(document).toContain('Trade with strangers, protected.');
  expect(document).not.toContain('class="screen-num"');
});

it('carves the one screen that uses the device bezel', () => {
  expect(carveScreen(html, findScreen(rows, 'P1'))).toMatchObject({ device: 'mobile', width: 230 });
});

it('carves a desktop and a tablet screen at the declared widths', () => {
  expect(carveScreen(html, findScreen(rows, 'P2-D1')).width).toBe(1040);
  expect(carveScreen(html, findScreen(rows, 'P2-T1')).width).toBe(560);
});

it('balances the tags it replays', () => {
  for (const row of loadScreens()) expectBalanced(carveScreen(html, row).document);
});
```

The last one is the real guard: 210 carves, each parsed back with the same scanner, asserting no element is left open.

- [ ] **Step 2: Run the tests** — Expected: FAIL.

- [ ] **Step 3: Implement.** The scanner is the only subtle part; the comment says why a regex `querySelector` substitute is acceptable here (one known document, generated, no `<script>` writing markup) and what it deliberately does not handle.

- [ ] **Step 4: Run `pnpm --filter @komtru/visual-check test lint typecheck`** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(visual-check): carve one reference screen into a standalone document`

---

### Task 3: The font stylesheet

**Files:**

- Create: `tools/visual-check/src/fonts.ts`, `tools/visual-check/test/fonts.test.ts`
- Modify: `tools/visual-check/package.json` (three Fontsource dependencies, exact versions)

**Interfaces:**

- `FONT_FACES: readonly { family: string; package: string; file: string; weight: string; style: 'normal' }[]` — Space Grotesk variable, Inter variable, IBM Plex Mono 400/500/600, `latin` subset, matching `packages/ui-kit/src/fonts.ts`.
- `fontStylesheet(): string` — one `<style>`-ready CSS string: an `@font-face` per entry with a base64 `data:font/woff2` src and `font-display: block`, plus the determinism rules (no animation, no transition, transparent caret).

- [ ] **Step 1: Write the failing test**

```ts
it('declares the three families the reference names', () => {
  const css = fontStylesheet();
  for (const family of ['Space Grotesk', 'Inter', 'IBM Plex Mono'])
    expect(css).toContain(`font-family: '${family}'`);
});

it('names exactly the families tokens.css names', () => {
  const families = [...new Set(FONT_FACES.map((face) => face.family))];
  const named = ['--font-display', '--font-body', '--font-mono'].map((token) =>
    KOMTRU_TOKENS[token].split(',')[0].replaceAll("'", ''),
  );
  expect(families).toEqual(named);
});

it('inlines the files so nothing is fetched at screenshot time', () => {
  expect(fontStylesheet()).toMatch(/src: url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\)/);
  expect(fontStylesheet()).not.toMatch(/https?:/);
});

it('blocks paint until the faces load', () => {
  expect(fontStylesheet()).toContain('font-display: block');
});

it('stops animation on both pages', () => {
  expect(fontStylesheet()).toContain('animation: none !important');
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Install the three Fontsource packages and implement.** The header comment is the font decision above, in three sentences.

- [ ] **Step 4: Run the tests** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(visual-check): inline the brand webfonts into both pages`

---

### Task 4: Pixel diff and the side-by-side composite

**Files:**

- Create: `tools/visual-check/src/diff.ts`, `tools/visual-check/test/diff.test.ts`
- Modify: `tools/visual-check/package.json` (`pixelmatch`, `pngjs`, `@types/pngjs`)

**Interfaces:**

- `interface DiffResult { width; height; changed: number; total: number; ratio: number; heatMap: Buffer }`.
- `diffPngs(reference: Buffer, built: Buffer, options?: { threshold?: number }): DiffResult` — pixelmatch at threshold 0.1 with antialias tolerance on. Throws a message naming both sizes when they differ, rather than letting pixelmatch throw.
- `composeSideBySide(panels: Buffer[], options?: { gap?: number }): Buffer` — one PNG, panels left to right on a white canvas, separated by a 4px indigo (`--trust-indigo`) rule, top-aligned, canvas height = the tallest panel.

- [ ] **Step 1: Write the failing test** — generate the inputs rather than committing fixtures:

```ts
const solid = (w: number, h: number, rgb: [number, number, number]) => …; // PNG buffer

it('scores an identical pair as zero', () => {
  const png = solid(20, 10, [21, 151, 104]);
  expect(diffPngs(png, png)).toMatchObject({ changed: 0, ratio: 0, total: 200 });
});

it('scores a wholly different pair as one', () => {
  expect(diffPngs(solid(20, 10, [0, 0, 0]), solid(20, 10, [255, 255, 255])).ratio).toBe(1);
});

it('scores one changed pixel', () => {
  const { changed, ratio } = diffPngs(solid(20, 10, [255, 255, 255]), withPixel(solid(20, 10, [255, 255, 255]), 3, 4, [192, 57, 46]));
  expect(changed).toBe(1);
  expect(ratio).toBeCloseTo(1 / 200);
});

it('marks the changed pixel in the heat map', () => {
  const heat = readPng(diffPngs(a, b).heatMap);
  expect(pixelAt(heat, 3, 4)).not.toEqual(pixelAt(readPng(a), 3, 4));
});

it('names both sizes when they disagree', () => {
  expect(() => diffPngs(solid(20, 10, white), solid(21, 10, white))).toThrow(/20×10.*21×10/);
});

it('lays the panels out left to right', () => {
  const composite = readPng(composeSideBySide([solid(20, 10, red), solid(30, 12, blue)], { gap: 4 }));
  expect([composite.width, composite.height]).toEqual([54, 12]);
  expect(pixelAt(composite, 0, 0)).toEqual(red);
  expect(pixelAt(composite, 24, 0)).toEqual(blue);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Install `pixelmatch`, `pngjs`, `@types/pngjs` and implement.**

- [ ] **Step 4: Run the tests** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(visual-check): score a pixel diff and compose the side-by-side`

---

### Task 5: Screenshots

**Files:**

- Create: `tools/visual-check/src/render.ts`, `tools/visual-check/test/render.test.ts`
- Modify: `tools/visual-check/package.json` (`@playwright/test` 1.63.0)

**Interfaces:**

- `interface Shot { png: Buffer; width: number; height: number }`.
- `withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T>` — launches Chromium, always closes.
- `shootReference(browser, carved): Promise<Shot>` — sets the viewport to the carved width, `setContent` with `waitUntil: 'load'`, injects the font sheet, awaits `document.fonts.ready`, computes the clip as the union box of the frame's children excluding `.mweb-chrome`/`.dweb-chrome`, and element-clips to it.
- `shootBuilt(browser, url, size): Promise<Shot>` — viewport exactly `size`, navigates, injects the same font sheet, awaits `document.fonts.ready` and `networkidle`, screenshots the viewport. A navigation failure throws naming the URL and suggesting the app is not running.

Both use `deviceScaleFactor: 1` and `reducedMotion: 'reduce'`.

- [ ] **Step 1: Write the failing test**, `describe.runIf(process.env.KOMTRU_BROWSER_TESTS === '1')`:

```ts
it('shoots a mobile screen at the declared width without the mock chrome', async () => {
  const shot = await withBrowser((b) => shootReference(b, carveScreen(html, findScreen(rows, 'E1'))));
  expect(shot.width).toBe(340);
  expect(shot.height).toBeGreaterThan(400);
  // the chrome's URL pill is #EEF1F6; the screen below it is not
  expect(topRowIsChrome(shot)).toBe(false);
});

it('shoots desktop and tablet screens at their declared widths', async () => {
  expect((await shoot('P2-D1')).width).toBe(1040);
  expect((await shoot('P2-T1')).width).toBe(560);
});

it('renders the reference in the real brand faces', async () => {
  // with no @font-face the heading is Helvetica; with one it is Space Grotesk, and the two
  // measure differently. Shoot E1 with and without the sheet and assert the pixels differ.
});

it('shoots a built page at exactly the size it is given', async () => {
  const shot = await shootBuilt(browser, server.url, { width: 340, height: 500 });
  expect([shot.width, shot.height]).toEqual([340, 500]);
});
```

- [ ] **Step 2: `KOMTRU_BROWSER_TESTS=1 pnpm --filter @komtru/visual-check test`** — Expected: FAIL. Also run without the variable and confirm the suite skips.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run both ways** — Expected: PASS, and skipped without the flag.

- [ ] **Step 5: Commit** `feat(visual-check): screenshot the reference screen and the built page`

---

### Task 6: The run, the markdown stub and the CLI

**Files:**

- Create: `tools/visual-check/src/report.ts`, `tools/visual-check/src/run.ts`, `tools/visual-check/src/cli.ts`
- Create: `tools/visual-check/test/report.test.ts`, `tools/visual-check/test/run.test.ts`
- Modify: root `package.json` (`"visual-check"` script)

**Interfaces:**

- `report.ts` — `renderStub(input): string`: the screen's id, name, section and reference line; the URL; device, width and compared size; the capture time; `changed / total (ratio%)`; links to the two PNGs; and a `## Deviations` section with an empty checklist and one HTML comment saying how to fill it in. `mergeStub(existing, fresh)` keeps a hand-written deviation list and refreshes the metadata, so a second run does not erase the review.
- `run.ts` — `visualCheck({ screen, url, outDir, line? })`: locate → carve → one browser → two shots → diff → compose → write `<screen>.png`, `<screen>.diff.png`, `<screen>.md` under `<outDir>/<ticket>/`. Returns the paths and the ratio.
- `cli.ts` — `--screen` and `--url` required, `--out` (default `docs/ui-review`), `--line` to disambiguate `TO-PA10`, `--threshold`. Unknown or missing flags print the usage line from the ticket and exit 2. Prints the ratio and the three paths.

- [ ] **Step 1: Write the failing tests.**

`report.test.ts` (pure):

```ts
it('writes a stub naming the screen, the reference line and the score', () => {
  const md = renderStub(sample);
  expect(md).toContain('# U4 — ');
  expect(md).toContain('line 4321');
  expect(md).toContain('http://localhost:3004/handover/KMT-88213');
  expect(md).toContain('340 × 660');
  expect(md).toContain('## Deviations');
});

it('keeps a hand-written deviation list across runs', () => {
  const first = renderStub(sample);
  const edited = first.replace('<!-- ', '- [ ] the Protect button is 2px short\n\n<!-- ');
  expect(mergeStub(edited, renderStub({ ...sample, ratio: 0 }))).toContain('Protect button is 2px short');
});
```

`run.test.ts` (browser-gated) is the end-to-end proof the ticket asks for. It serves the carved document from a `node:http` server on an ephemeral port and points `--url` at it:

```ts
it('scores a screen against itself as zero', async () => {
  const { ratio, png, diff, markdown } = await visualCheck({ screen: 'E1', url: server.url, outDir: tmp });
  expect(ratio).toBe(0);
  for (const file of [png, diff, markdown]) expect(existsSync(file)).toBe(true);
  expect(png).toMatch(/T-111[/\\]E1\.png$/);
});

it('scores a deliberately altered copy as non-zero', async () => {
  server.html = carved.replace('--trust-emerald:#159768', '--trust-emerald:#C0392E');
  expect((await visualCheck({ screen: 'E1', url: server.url, outDir: tmp })).ratio).toBeGreaterThan(0);
});

it('works for a desktop and a tablet frame', async () => {
  for (const screen of ['P2-D1', 'P2-T1'])
    expect((await visualCheck({ screen, url: serverFor(screen), outDir: tmp })).ratio).toBe(0);
});
```

- [ ] **Step 2: Run both ways** — Expected: FAIL.

- [ ] **Step 3: Implement, and add the root script** `"visual-check": "node --experimental-strip-types tools/visual-check/src/cli.ts"`.

- [ ] **Step 4: Run the suites, then the real command** against a carved screen served locally, and look at the three artefacts.

- [ ] **Step 5: Commit** `feat(visual-check): write the side-by-side, heat map and deviation stub`

---

### Task 7: Documentation, ignores and close-out

**Files:**

- Create: `docs/ui-review/README.md`
- Modify: `.gitignore`, `docs/runbooks/dev-setup.md`, `docs/tickets/01-shared-packages.md`

- [ ] **Step 1:** Write `docs/ui-review/README.md`: what the harness compares and what it deliberately does not, the exact command, the three artefacts, the four widths and where they come from, the font decision in a paragraph, **that the PNGs are not committed and the `.md` stubs are**, how to read a heat map, and the checklist a UI ticket follows per screen.

- [ ] **Step 2:** Add `docs/ui-review/**/*.png` to `.gitignore`, and a short section to `docs/runbooks/dev-setup.md` pointing at the README.

- [ ] **Step 3: Run `pnpm exec turbo run build lint typecheck test --force`** and `KOMTRU_BROWSER_TESTS=1 pnpm --filter @komtru/visual-check test`; record the counts.

- [ ] **Step 4: Run `pnpm exec prettier --check .`** — Expected: clean.

- [ ] **Step 5:** Add the status lines to `docs/tickets/01-shared-packages.md` under `### T-016 — Visual-check harness`, with `- **Deferred:**` for anything left.

- [ ] **Step 6: Commit** `docs(ui-review): document the visual-check harness` and `docs(tickets): mark T-016 done`.

- [ ] **Step 7:** Request a fresh code review of the whole branch against `main`, triage, fix what is real, then re-run Steps 3 and 4.
