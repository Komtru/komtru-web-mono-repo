# Where the shells differ from the reference HTML

`test/shells-parity.test.tsx` is the enforced version of this list: a property a shell does not
reproduce has to be named there with a reason, and an entry that no longer deviates fails the suite.
This file is the same list in prose, plus the screen T-016 should shoot each shell against.

Every deviation falls into one of four groups, and nothing else is a deviation:

1. **The gallery frame is not the product.** The reference draws each screen inside a 340px phone or
   a 560/1040px mock browser, and those frames carry heights and scrollers the product has no use
   for.
2. **Tailwind cannot write it literally.** A shorthand the preset only publishes as longhands.
3. **The reference states it inline rather than in a rule**, so there is nothing to diff against.
4. **The reference disagrees with itself**, and the ticket decides.

---

## The gallery frame

| Shell                             | Property                      | What the reference says                                   | What the shell does                                                                                                                                                                                                                                                                               |
| --------------------------------- | ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MobileShell` (`.mweb-screen`)    | `height: 660px`               | the drawn phone's screen                                  | `min-h-dvh` — the page is the viewport                                                                                                                                                                                                                                                            |
| `MobileShell` (`.mweb-screen`)    | `overflow-y: auto`            | the phone scrolls inside the gallery                      | dropped; the document scrolls                                                                                                                                                                                                                                                                     |
| `DesktopShell` (`.dweb-content`)  | `overflow-y: auto`            | the mock browser's content box scrolls                    | dropped; an inner scroller would strand the sidebar and break every sticky bar above it                                                                                                                                                                                                           |
| `PublicShell` (`.dweb-content`)   | `overflow-y: auto`            | same                                                      | dropped; a public profile is one scrolling document                                                                                                                                                                                                                                               |
| `ConsoleShell` (`.ko-dweb-shell`) | `min-height: 620px`           | sizes the drawn frame                                     | `min-h-dvh`                                                                                                                                                                                                                                                                                       |
| `DesktopShell` (`.dweb-shell`)    | `min-height: 520px` / `560px` | two sections of the gallery size their frames differently | `min-h-dvh`. **This rule has no parity row at all**: the reference declares it twice with different values in one `<style>` block, so the harness refuses to merge it and `shells-parity.test.tsx` asserts that it still refuses. `display:flex` is asserted directly in `DesktopShell.test.tsx`. |

Screens to shoot: AC1 and E3 (mobile), D9 and T1 (consumer), NAV and TO-PA9 (console).

## Tailwind cannot write it literally

| Shell                               | Property                                            | Why                                                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ConsoleShell` (`.ko-dweb-sidebar`) | `box-sizing: border-box`                            | Tailwind's preflight already sets it on every element, so no utility in the list carries it. The computed value is identical. Same for `.ko-dweb-item`.                                                                                    |
| `ConsoleShell` (`.ko-dweb-sidebar`) | `transition: width .18s ease, flex-basis .18s ease` | written as `transition-[width,flex-basis] duration-[180ms] ease-[ease]`, which Tailwind emits as three longhands plus its own custom properties. The property, duration and easing are the same; `motion-reduce:transition-none` is added. |

## Stated inline, not in a rule

- **D8's two-column split.** The reference writes `display:flex; gap:24px; align-items:flex-start`
  and `width:280px; flex-shrink:0` as inline styles on the screen, not as a rule, so there is no
  selector to diff `PublicShell` against. The 280px rail is asserted in `PublicShell.test.tsx` and
  at all four widths in `four-widths.test.tsx`; what parity does pin is the content region D8 shares
  with the app shell (`.dweb-content`).
- **D8 draws no header.** The reference leans on the mock browser chrome above the frame. A real
  public page has none, so `PublicShell` takes an optional `brandLabel` — omitted it is D8 exactly,
  given it is the brand-only bar T5 draws for the same page at tablet.

## The reference disagrees with itself

- **The console's own breakpoints are 900px and 640px.** `<style id="komtru-nav-v2">` collapses the
  rail under `@media(max-width:900px)` and stacks `.ko-page-head` under `@media(max-width:640px)`.
  The ticket's scale — and the reference's own two `.breakpoint-note` blocks — say 640 / 768 / 1024.
  The ticket wins: `ConsoleShell`'s rail collapses at `lg` (1024), 124px later than the sheet does.
  The page head stacks below `sm`, which is one pixel earlier than `max-width:640px` (Tailwind's
  `sm:` fires _at_ 640, the reference's media query stops _after_ it).
- **`.ko-dweb-sidebar` is 228px, not the 180px its own section's prose claims**, and
  `.ko-dweb-content` is `24px 28px 28px`, not 24px. The rules win over the prose: they are what
  every TrustOps screen in the file is drawn against.

## Added beyond the HTML, deliberately

| Shell               | Addition                                                                     | Why                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DesktopShell`      | `min-width: 0` on the content region                                         | a flex child's default `min-width:auto` lets a wide table push the sidebar off-screen. The reference's content never overflows; a real screen's does.                                              |
| `ConsoleShell`      | `title` and `aria-label` on every destination                                | the collapsed rail hides every label, and the reference gives a bare glyph neither a name nor a tooltip.                                                                                           |
| `ConsoleShell`      | `hover:bg-surface-secondary` only on destinations that are **not** current   | Tailwind emits `hover:` after the base utilities, so a hover background on the active item would beat its indigo pill — the reverse of the reference, where `:hover` is declared before `.active`. |
| every nav           | a `RangeError` when two destinations are marked current                      | two `aria-current="page"`s are announced as two current pages. The reference never draws it, so it is a caller's mistake, and a silent one.                                                        |
| every nav           | `aria-current="page"`, landmark roles, `<header>`/`<main>`/`<aside>`/`<nav>` | the reference is a drawing made of `<div>`s.                                                                                                                                                       |
| `TabBar`, `SideNav` | the focus ring as a utility                                                  | the reference states it once, globally; `ui-kit` ships no stylesheet, so each focusable element carries it. Same decision T-012 made.                                                              |
| `ConsoleShell`      | `justify-start` at `lg`, `sm:flex-row` on the page head                      | both are the initial value, written only to undo the collapsed/stacked state the smaller width needs.                                                                                              |
