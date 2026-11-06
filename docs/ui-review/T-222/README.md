# T-222 — TabBar re-based on v2's `.komtru-mobile-nav`

## What was compared

`docs/design-reference/Komtru — UI Living Master v2.html`, `<style id="komtru-mobile-ia-v2">`, with `komtru-layout-reconcile` laid over it:

| Lines (v2)  | Rule                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1936        | `.komtru-mobile-nav`: sticky bottom bar, grid, 4px gap, `8px 8px calc(8px + safe-area)` padding, `rgba(255,255,255,.97)`, 1px hairline top border, `0 -6px 18px` shadow, `blur(12px)` |
| 1937        | `.kmn-item`: 48px min-height, centred column, 4px gap, 12px radius, `#7A8496`, 10px / 600 (superseded below) / `.01em`, 150ms background and colour transition                        |
| 1938        | `.kmn-item svg`: 20px                                                                                                                                                                 |
| 1939        | `.kmn-item.is-active`: `#4552D6` text on `#EDEFFC` (the indigo-soft pill)                                                                                                             |
| 1940        | `:focus-visible`: 2px indigo outline, 2px offset                                                                                                                                      |
| 11957-11958 | `komtru-layout-reconcile`: five columns and `.kmn-item{font-size:9.5px}`. Later in the cascade, so this is what v2 renders                                                            |
| 1950, 1951  | `max-width:380px` squeeze; reduced-motion                                                                                                                                             |

The frame at l.7481 uses the same markup.

`packages/ui-kit/test/tabbar-parity.test.tsx` now reads v2 (the old `.scr-tabbar` rows are removed
from `shells-parity.test.tsx`) for four rows: nav, item, active item, icon. The harness gained two
small capabilities in `test/reference-css.ts`: box shorthands no longer split inside `calc(...)`,
and `(prefers-reduced-motion:reduce)` counts as not holding.

## Deviations

- **Columns:** `grid-flow-col auto-cols-fr` (equal `minmax(0,1fr)` tracks) instead of
  `repeat(4|5,...)`, because `TabBar` takes any number of items. Recorded in `DEVIATIONS`.
- **Resting colour `#7A8496` has no token** (`trust-gray` is `#9AA5B8`, `slate` is `#4C5568`). It is
  written as a literal with a scoped `eslint-disable`, and parity holds it to the reference. A token
  would be a design-system decision. Note that grey on white at 10px is below 4.5:1; v2 chose it.
- **Focus ring** stays the shared `FOCUS_RING` (2.5px global ring) instead of v2's item-specific
  2px; the ring is the system's, as in T-012.
- **`stroke-current` on the icon wrapper:** v2 sets `stroke="currentColor"` on each glyph; a
  caller's icon does not, so the wrapper passes the item's colour down.
- **Transition** is Tailwind's longhands (`transition-[background-color,color] duration-150`),
  and `motion-reduce:transition-none` matches l.1951. Both in `DEVIATIONS`/`ADDITIONS`.
- The 380px squeeze (5px padding, 2px gap, 9px label) is not reproduced; v2's own 9.5px rule
  overrides its label half.
- The label span no longer carries its own size/weight/colour; it inherits from the item, as in v2.

## Verification

ui-kit lint, typecheck and tests; `@komtru/web-app-ui` typecheck and tests; prettier on
`packages/ui-kit/src` and `docs`. The four-widths test still passes (the bar carries no responsive
variant). axe at four widths is covered by the existing four-widths suite; contrast of the resting
grey is noted above.

## Ticket text corrected

The ticket first said "10px labels", read from the earlier `komtru-mobile-ia-v2` rule. v2's final
cascade is 9.5px (l.11958), so the acceptance criteria now say 9.5px and the parity rows read both
blocks, asserting what v2 renders. The harness accepts a list of style ids, laid over each other in
order.
