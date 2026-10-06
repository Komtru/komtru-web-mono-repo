# T-012 `ui-kit` Core Primitives and Storybook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@komtru/ui-kit` exports the seventeen primitives every Komtru screen is assembled from — Button, Chip, Avatar, Card, TradeRow, Stepper, OtpInput, TextField, Select, Toggle, Sheet, Toast, Skeleton, NodeLoader, EmptyState, Banner, FileDropzone — each emitting the Tailwind utilities that compile to the reference HTML's own declarations, each with a Vitest + Testing Library test for its states and keyboard focus, and each with a Storybook story.

**Architecture:** A primitive is a presentational React component that emits token utilities (`bg-pure-white`, `text-risk`, `rounded-md`) and nothing else — no CSS file, no `styled`, no runtime theme. Fidelity is not asserted by eyeballing class strings: `test/primitives-parity.test.tsx` renders each primitive with `react-dom/server`, harvests its `class` attributes, compiles them through `@komtru/config/tailwind/preset.css` with Tailwind's own `compile()`, and diffs the resulting declarations against the rule the reference HTML declares for that primitive's class (`.btn-primary`, `.chip.protected`, `.otp-cell.filled`, …). Every difference is either absent or listed, with a reason, in a single `DEVIATIONS` table that the test itself reads — so a deviation cannot be introduced without being written down. Behaviour, state and keyboard focus are tested separately per component under jsdom.

**Tech Stack:** Node 22, TypeScript 6 strict (`moduleResolution: bundler`, `jsx: react-jsx`), React 19, Tailwind CSS v4.3.3, Vitest 5 + jsdom + @testing-library/react, Storybook 10.6.1 (`@storybook/react-vite`, Vite 8), ESLint 9 flat config.

**Spec:** `docs/tickets/01-shared-packages.md` (T-012); source of truth `docs/design-reference/Komtru — UI Screens Living Master File.html`; screen-to-line map `docs/design-reference/SCREEN_INDEX.md`.

## Global Constraints

- The HTML is authoritative and literal. Every padding, radius, font-size and state colour is read out of it, not chosen. Where the reference writes `13.5px` or `1.5px`, the component writes `text-[13.5px]` / `border-[1.5px]`; Tailwind's default spacing/text scales stay available because the reference is full of off-scale values.
- Tailwind's default colour palette is retired. `bg-white`, `text-gray-500`, `bg-red-500` do not compile. Colours are token utilities only (`bg-pure-white`, `text-slate`, `bg-risk-soft`, `text-success-on-soft`, `border-border-hairline`).
- Radii are `rounded-sm|md|lg|full` (T-011: `rounded-r-md` is Tailwind's right-side modifier). Durations have no utility — write `duration-[var(--dur-standard)]` or `var(--dur-standard)` in an arbitrary value.
- `komtru-design/no-raw-hex` is on. No hex literal without a file-level disable and a reason. `#fff` is `--pure-white`; the sheet scrim's `rgba(13,20,32,.55)` is not hex and is written as an arbitrary value, verbatim from the reference.
- Component tests begin with `// @vitest-environment jsdom`. The parity test does **not**: under jsdom Vite rewrites `import.meta.url` into `/@fs`, which breaks both the reference-HTML read and Tailwind's stylesheet resolution. It runs in node and renders with `react-dom/server`.
- `@komtru/ui-kit/fonts` throws outside a Next build. Neither the primitives, the tests, nor `.storybook/**` may import it.
- ESM with `.js` extensions on relative imports. New dependencies pinned exactly, no `^`.
- No dark theme, no `prefers-color-scheme`. The reference defines none.
- Accessibility floor beyond the HTML, applied consistently and listed as intentional deviations: every interactive primitive is a real focusable element with the global `:focus-visible` ring (2.5px `--trust-indigo`, offset 2px) reaching it; every animation carries `motion-reduce:animate-none`; icon-only controls carry an accessible name.

## Review Focus

1. **Fidelity must be proven, not asserted.** A test that only checks `expect(button).toHaveClass('bg-midnight-text')` proves nothing about the reference. The parity test must compile the real utilities and compare real declarations, and must fail if a component's class is changed to one that compiles to something else (Task 2).
2. **Deviations must be impossible to hide.** The parity test compares the full declaration set; anything the component does not reproduce has to appear in `DEVIATIONS` with a reason, or the test fails. An empty-by-default allowlist is the point.
3. **The mandatory-media gate is the ticket's one piece of real logic.** `FileDropzone` must keep the action disabled until `requiredCount` media are attached (reference W1, line 5649: "Accept stays disabled until real media is attached"), must say why in the `guard-lock-banner`, and must not let a caller bypass the gate by passing `disabled={false}` (Task 10).
4. **OtpInput keyboard behaviour.** Six cells, digits only, backspace moves back through empties, arrows move, a 6-digit paste fills all cells, focus is visible on the active cell. The reference's `cursor` cell is the focused one; `filled` is any cell with a value; the wrong-code screen (E3b, line 2063) colours every cell `--risk`/`--risk-soft` at once, not just the bad one (Task 8).
5. **Sheet focus management.** Opening moves focus into the sheet, Escape closes, focus returns to the opener, and focus does not escape to the page behind. No `document` access — ESLint runs with `react: false`, so browser globals are not declared; use refs and React events.
6. **Server components.** Only the stateful primitives (OtpInput, Toggle, Sheet, Toast, FileDropzone) carry `'use client'`. Button, Chip, Avatar, Card, TradeRow, Stepper, TextField, Select, Skeleton, NodeLoader, EmptyState, Banner must render in an RSC context with no hook and no directive.

---

### Task 1: Primitive scaffolding and the class-name helper

**Files:**

- Create: `packages/ui-kit/src/primitives/cx.ts`
- Create: `packages/ui-kit/src/primitives/index.ts`
- Create: `packages/ui-kit/test/primitives/cx.test.ts`
- Modify: `packages/ui-kit/src/index.ts` (re-export `./primitives/index.js`)

**Interfaces:**

- Produces `cx(...parts: (string | false | null | undefined)[]): string` — joins truthy parts with a single space, trims, collapses. No `clsx` dependency: the repo pins exact versions and this is six lines.

- [ ] **Step 1: Write the failing test** — `cx('a', false, undefined, 'b')` is `'a b'`; `cx()` is `''`; nested whitespace collapses.
- [ ] **Step 2: Implement** `cx`.
- [ ] **Step 3: Verify** `pnpm --filter @komtru/ui-kit test`.

---

### Task 2: The parity harness and `DEVIATIONS`

**Files:**

- Create: `packages/ui-kit/test/primitives-parity.test.tsx`
- Create: `packages/ui-kit/test/reference-css.ts`
- Modify: `packages/ui-kit/package.json` (add `tailwindcss` 4.3.3 and `react-dom` server usage; `@types/react-dom` is already present)

**Interfaces:**

- `referenceRule(html, selector): Map<string, string>` — returns the declarations the reference HTML declares for a selector, merged in source order across every `<style>` block (the reference restates `.chip` in five blocks; they agree, and the helper asserts they do). Values are normalised: whitespace collapsed, `#fff`/`#FFFFFF` rewritten to `var(--pure-white)`, the `background:` shorthand carrying a single colour rewritten to `background-color:`, `font: 600 11px var(--font-body)` expanded into `font-weight`/`font-size`/`font-family`.
- `compiledDeclarations(classNames): Promise<Map<string, string>>` — compiles the candidates against `packages/config/tailwind/preset.css` and merges the declarations, last-wins, the way the cascade would.
- `classesOf(element: React.ReactElement, testId: string): string[]` — `renderToStaticMarkup`, then read the `class` attribute of the node carrying `data-parity="<testId>"`.
- `DEVIATIONS: Record<string, { property: string; reason: string }[]>` — keyed by parity id. Starts empty; every entry is a deviation that also lands in the ticket's `- **Deferred:**` list.

- [ ] **Step 1: Write the failing test.** A table of `{ id, selector, element }` rows, initially one row for a deliberately wrong Button, asserting the harness reports the mismatch. Then assert for every row: every property the reference declares is either reproduced with an equal value, or named in `DEVIATIONS[id]`.
- [ ] **Step 2: Implement** `reference-css.ts` and the harness.
- [ ] **Step 3: Verify** the harness fails loudly on a seeded mismatch, then passes with the correct Button from Task 3.

---

### Task 3: Button and StickyFooter

**Reference:** `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger` / `.btn-sticky` (lines 111–113, 409, 1399). Usage: E4 (2028), AC1 (2328), W1 (5649), CT1 (4172).

**Files:**

- Create: `packages/ui-kit/src/primitives/Button.tsx`, `.../StickyFooter.tsx`
- Create: `packages/ui-kit/test/primitives/Button.test.tsx`

**Interfaces:**

- `<Button variant="primary" | "secondary" | "ghost" | "danger">` extending `React.ButtonHTMLAttributes<HTMLButtonElement>`; `type` defaults to `'button'`.
- `<StickyFooter>` — `.btn-sticky`: sticky to the bottom, the reference's `linear-gradient(to top, var(--surface-primary) 70%, transparent)`, `margin-top:auto`, column layout with `gap-2` when it holds more than one child (the reference writes that inline on every instance).

- [ ] **Step 1: Write the failing tests** — renders each variant; `type="button"` by default; `disabled` sets `aria-disabled` and blocks `onClick`; `:focus-visible` reaches the button (focus it, assert `document.activeElement`); the sticky footer renders its children in order.
- [ ] **Step 2: Implement**, adding the four parity rows.
- [ ] **Step 3: Verify.**

---

### Task 4: Chip, Avatar, Card

**Reference:** `.chip` + `.protected|.awaiting|.risk|.resolved|.verified` and `.chip .dot` (103–109); `.avatar` (102) and its 20px/40px/44px instances (120, 4124, 4006); `.item-card` (128).

**Files:**

- Create: `packages/ui-kit/src/primitives/Chip.tsx`, `Avatar.tsx`, `Card.tsx`
- Create: the three matching tests

**Interfaces:**

- `<Chip tone="protected" | "awaiting" | "risk" | "resolved" | "verified" dot?>` — `dot` defaults true; the dot is `bg-current`, which computes to exactly the inline `var(--…-on-soft)` the markup writes.
- `<Avatar initials size?="sm" | "md" | "lg" tone?="info" | "warning" | "success">` — sizes 20/34/44px with the reference's 9/12/15px type. `aria-hidden` unless `label` is given.
- `<Card padding?="sm" | "md" | "lg" radius?="md" | "lg" as?>` — the reference's three card paddings (12/14/16) over surface-primary + hairline border.

- [ ] **Step 1: Write the failing tests** — each chip tone; the dot is suppressible; avatar initials are uppercased and capped at two characters; a card renders its children and accepts `as="section"`.
- [ ] **Step 2: Implement**, adding parity rows for all five chip tones, avatar, and `.item-card`.
- [ ] **Step 3: Verify.**

---

### Task 5: TradeRow and the 5-step progress

**Reference:** `.trade-row` + `.tr-top|.tr-amt|.tr-parties|.tr-sub` (116–121); `.progress-5step` + `.p5-seg.done|.active` and `.progress-5step-labels` (1190–1195). Usage: Z1 (2489), OF1 (2417).

**Files:**

- Create: `packages/ui-kit/src/primitives/TradeRow.tsx`, `TradeProgress.tsx`
- Create: the two matching tests

**Interfaces:**

- `TRADE_STAGES = ['Agreement', 'Protected', 'Shipped', 'Inspection', 'Release'] as const`, read from the reference's own labels.
- `<TradeProgress stage={1..5}>` — segments before the stage `done` (emerald), the stage `active` (indigo), the rest neutral; `role="progressbar"` with `aria-valuenow`/`aria-valuemax` and an accessible name.
- `<TradeRow amount counterparty={{ name, initials, tone? }} chip? sub? stage? href? onClick?>` — renders as `<a>` when `href` is given, `<button>` when `onClick` is, a `<div>` otherwise. The reference draws it as a tappable block.

- [ ] **Step 1: Write the failing tests** — amount in `font-mono`; both chip and sub render; progress reports the right stage; the row is reachable by keyboard when interactive and not focusable when not.
- [ ] **Step 2: Implement**, adding parity rows for `.trade-row`, `.tr-amt`, `.p5-seg.done`, `.p5-seg.active`.
- [ ] **Step 3: Verify.**

---

### Task 6: Stepper

**Reference:** `.ko-stepper` / `.ko-step` / `.ko-step .dot` / `.ko-step-line` (line 1537) — the horizontal numbered rail the multi-step onboarding wizards use. The alternate centred-dot form (`.ko-stepper` at 1572, `.p0-stepper` at 1631) is the same semantics with the rail behind the label; listed as a deviation rather than reproduced twice.

**Files:**

- Create: `packages/ui-kit/src/primitives/Stepper.tsx`, `packages/ui-kit/test/primitives/Stepper.test.tsx`

**Interfaces:**

- `<Stepper steps={string[]} current={number}>` — an ordered list, `aria-current="step"` on the active step, the connector drawn between steps and never after the last.

- [ ] **Step 1: Write the failing test** — step count; `aria-current` on exactly one step; one fewer connector than steps; a `current` outside the range throws.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.**

---

### Task 7: TextField and Select

**Reference:** `.field`, `.field label`, `.field .helper`, `.field .helper.ok` (419–423); `.input`, `.input:focus`, `.input.mono-code` (424–426); `.m-textarea` (231). Select chrome is the reference's own `.input` shape (`.ko-field select`, `.p3-field select`, G1 at 9109).

**Files:**

- Create: `packages/ui-kit/src/primitives/TextField.tsx`, `Select.tsx`, `Field.tsx` (the shared label + helper wrapper)
- Create: the matching tests

**Interfaces:**

- `<Field label helper? helperTone?="muted"|"ok"|"error" htmlFor id>` — the label/helper furniture, used by both.
- `<TextField label helper? invalid? mono? multiline?>` extending the input attributes; the input is wired to the helper with `aria-describedby`, and `aria-invalid` when `invalid`.
- `<Select label helper? invalid?>` extending the select attributes, with `options` or children.

- [ ] **Step 1: Write the failing tests** — the label is associated (`getByLabelText` finds the control); helper text is announced via `aria-describedby`; `invalid` sets `aria-invalid` and the risk colours; typing updates a controlled value; the field takes focus from a label click.
- [ ] **Step 2: Implement**, adding parity rows for `.input`, `.field label`, `.field .helper`.
- [ ] **Step 3: Verify.**

---

### Task 8: OtpInput

**Reference:** `.otp-row` (428), `.otp-cell` / `.filled` / `.cursor` (429–431). Usage: E3 (2001), E3b wrong code (2055).

**Files:**

- Create: `packages/ui-kit/src/primitives/OtpInput.tsx`, `packages/ui-kit/test/primitives/OtpInput.test.tsx`

**Interfaces:**

- `<OtpInput length={6} value onChange onComplete? invalid? label>` — `length` defaults to 6. One `<input inputMode="numeric">` per cell inside a `role="group"` with the label. `invalid` paints every cell `--risk`/`--risk-soft`, matching E3b.

- [ ] **Step 1: Write the failing tests** — typing a digit advances focus; a non-digit is rejected; backspace on an empty cell moves back and clears the previous; `ArrowLeft`/`ArrowRight` move; pasting `482315` fills all six and fires `onComplete`; `invalid` sets `aria-invalid` on the group and the risk classes on every cell; the focused cell is the `cursor` cell.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.**

---

### Task 9: Toggle, Sheet, Toast

**Reference:** `.m-switch` / `.on` / `.locked` (259–263), usage C10 (4118); `.bottom-sheet-overlay` / `.bottom-sheet` / `.sheet-handle` (1204–1206), usage CT1 (4172), C4 (4622); **no toast rule exists** — the reference says of Trade Complete "A real moment, not just a toast" (3978), so Toast is composed from `.offline-banner`'s geometry (1409) and recorded as a deviation.

**Files:**

- Create: `packages/ui-kit/src/primitives/Toggle.tsx`, `Sheet.tsx`, `Toast.tsx`
- Create: the three matching tests

**Interfaces:**

- `<Toggle checked onChange label locked?>` — `role="switch"`, `aria-checked`, `aria-readonly` when locked (the reference's "Dispute & fraud alerts — Always on"), Space and Enter toggle, a locked toggle does not.
- `<Sheet open onClose title children>` — `role="dialog" aria-modal="true"`, the scrim, the handle, focus into the sheet on open and back to the opener on close, Escape closes, a click on the scrim closes, a click inside does not.
- `<Toast tone="success"|"info"|"warning"|"risk" title body? onDismiss?>` — `role="status"` (`role="alert"` for `risk`), `aria-live` polite/assertive.

- [ ] **Step 1: Write the failing tests** — toggle on/off/locked, keyboard activation; sheet focus in, Escape out, focus restored, scrim vs. content clicks; toast live-region role per tone, dismiss button has an accessible name.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.**

---

### Task 10: Skeleton, NodeLoader, EmptyState, Banner, FileDropzone

**Reference:** `.skeleton` + `@keyframes shimmer` and `.skel-line.w40|w60|w80` (1223–1226); `.node-loader` / `.nl-dot` + `@keyframes nodePulse` + `.loading-caption` (1218–1222, 1227–1230), usage AB3 (4500); `.state-panel` / `.empty` / `.error` (1269–1276), usage AC1 (2328); `.scope-note` (51), `.offline-banner` (1409), `.guard-lock-banner` / `.ready` (1101–1108), `.inspect-banner` (159); `.m-upload` (232–235), `.proof-media-grid` / `.proof-thumb` / `.empty` / `.play-badge` (1110–1115), gate at W1 (5649).

**Files:**

- Create: `packages/ui-kit/src/primitives/Skeleton.tsx`, `NodeLoader.tsx`, `EmptyState.tsx`, `Banner.tsx`, `FileDropzone.tsx`
- Create: the five matching tests

**Interfaces:**

- `<Skeleton width? height? lines?>` — `aria-hidden`, `motion-reduce:animate-none`.
- `<NodeLoader title body?>` — the three emerald dots at 0 / .18s / .36s with the reference's `nodePulse` keyframes, plus the caption. TXP Principle Six (4493): no bare spinner, every delay names what is happening. `title` is required for that reason.
- `<EmptyState tone="empty"|"error" icon title body action? secondaryAction?>` — explain (`title`) → benefit (`body`) → action, the order AC1 uses.
- `<Banner tone="info"|"warning"|"risk"|"success" icon? title? children>` — `.scope-note` is `tone="info"` with no title.
- `<FileDropzone label hint media requiredCount? onAdd onRemove? slots?>` — renders the dashed `m-upload` target and a `proof-media-grid` of `slots` (default 3) thumbs. Exports `isMediaGateSatisfied(media, requiredCount)` and renders the `guard-lock-banner` naming what is missing while the gate is unmet. `<MediaGate requiredCount media>{(satisfied) => …}</MediaGate>` gives the consuming screen the disabled flag; the gate is computed, never passed in.

- [ ] **Step 1: Write the failing tests** — skeleton is hidden from the a11y tree; node loader names the wait; empty state renders explain→benefit→action in DOM order and the action is reachable by keyboard; each banner tone picks the right soft/on-soft pair and `risk` is `role="alert"`; the dropzone accepts a file through the hidden input and through drop, `isMediaGateSatisfied` is false below `requiredCount`, the gate banner names the shortfall, and a consumer following `MediaGate` cannot enable its action early.
- [ ] **Step 2: Implement**, adding the parity rows.
- [ ] **Step 3: Verify.**

---

### Task 11: Exports, lint, typecheck, and the hand-written deviation list

**Files:**

- Modify: `packages/ui-kit/src/primitives/index.ts`, `packages/ui-kit/src/index.ts`
- Modify: `packages/ui-kit/tsconfig.build.json` (exclude `**/*.stories.tsx`)
- Create: `packages/ui-kit/src/primitives/DEVIATIONS.md` — the visual-check list T-016 will work from: per primitive, the reference instance (screen id + line) to shoot against, and the deviations already known.
- Create: `packages/ui-kit/test/primitives/exports.test.ts`

- [ ] **Step 1: Write the failing test** — every primitive is reachable from `@komtru/ui-kit`'s root entry; no module reaches `./fonts.js`; only the five stateful primitives carry `'use client'`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify** `pnpm exec turbo run build lint typecheck test --force` and `pnpm exec prettier --check .`.
- [ ] **Step 4: Commit** the primitives and their tests. A complete, tested component set stands on its own if Storybook turns out to be a large lift.

---

### Task 12: Storybook

**Files:**

- Create: `packages/ui-kit/.storybook/main.ts`, `.storybook/preview.ts`, `.storybook/preview.css`
- Create: `packages/ui-kit/src/primitives/*.stories.tsx` (one per primitive)
- Modify: `packages/ui-kit/package.json` (`storybook` / `build-storybook` scripts, pinned deps)
- Modify: `.gitignore` (`storybook-static`)

**Interfaces:**

- Storybook 10.6.1 with `@storybook/react-vite` 10.6.1 — the first line that supports Vite 8 (installed via Vitest 5) and React 19. Pinned exactly.
- `preview.css` imports `@komtru/config/tailwind/preset.css` through `@tailwindcss/vite`, plus the three Google font stylesheets by `<link>`: `@komtru/ui-kit/fonts` throws outside a Next build, so the preview loads the webfaces itself (T-011 flagged this).
- Stories are CSF4 `Meta`/`StoryObj`, one per primitive, with a story per documented state.

- [ ] **Step 1: Add Storybook** and confirm `build-storybook` succeeds.
- [ ] **Step 2: Write the stories.**
- [ ] **Step 3: Verify** the whole repo again, plus `pnpm --filter @komtru/ui-kit build-storybook`.
- [ ] **Step 4: Commit.**

---

### Task 13: Close out

- [ ] Mark T-012 Done in `docs/tickets/01-shared-packages.md` with the plan path and a `- **Deferred:**` list carrying every entry from `DEVIATIONS` plus the primitives still needing a T-016 screenshot.
- [ ] Request a fresh whole-branch code review, triage it, fix what is real.
