# TrustOps patterns — deviations from the reference

Every row in `test/trustops-parity.test.tsx` compiles a pattern's Tailwind utilities through the real
`@komtru/config` preset and diffs the declarations against the rule the reference HTML declares for
it. A property a pattern does not reproduce has to appear in that file's `DEVIATIONS` with a reason;
a property it adds has to appear in `ADDITIONS`; an entry in either that no longer applies fails the
suite. This file is the same list in prose, plus the screen and line to shoot each pattern against.

## Where to shoot each pattern

| Pattern          | Reference                                          | Screen                      | Line                         |
| ---------------- | -------------------------------------------------- | --------------------------- | ---------------------------- |
| `CaseLayout`     | `.case-header` + `.case-layout`                    | N2, TO-PA2                  | 3581, 8855                   |
| `DecisionPanel`  | `.case-resolution`                                 | N2                          | 3617                         |
| `AdvisoryBox`    | `.ai-recommend`                                    | N2, TO-PA2, PH7, AC9b, AC10 | 3620, 8877, 6810, 7702, 7753 |
| `PolicyCite`     | `.policy-cite`                                     | N2, TO-PA2                  | 3631, 8884                   |
| `EvidenceMatrix` | `.p13-req` + `.p13-state`                          | TO-PA2                      | 8862                         |
| `Timeline`       | `.p0-timeline` + `.p0-event`                       | P0-02, P0-03                | 8500, 8562                   |
| `TrustTrail`     | the same, plus `.p13-audit`                        | TO-PA5                      | 8977                         |
| `KpiCard`        | `.dash-stat`                                       | TO-PA8                      | 8295                         |
| `FilterBar`      | `.filter-bar` + `.search-box` + `.filter-chip`     | N1, TO-PA7                  | 3533, 8281                   |
| `DataTable`      | `.table-wrap` + `table.data-table` + `.table-foot` | N1, TO-PA7                  | 3540, 8283                   |
| `PeriodFilter`   | `.filter-chip` as a one-of-five                    | TO-PA7, TO-PA8              | 8281, 8295                   |

Shot so far: N2 (`docs/ui-review/T-014/T-142/N2.md`, 4.83% of pixels differ) and TO-PA2
(`docs/ui-review/T-014/T-147/TO-PA2.md`, 4.18%). Both reviews list what the heat map shows.

## Deviations

- **`.case-layout` is one column below `md`.** The reference draws the desktop console only, so
  `grid-template-columns` is `1.3fr 1fr` at every width. This package is mobile-first: the base is
  one column and the two-column grid arrives at `md`. The parity harness skips variant classes, so
  what it compares is the base; `CaseLayout.test.tsx` asserts both halves.
- **The timeline rail and its nodes are real elements, not `::before`.** `ui-kit` ships no
  stylesheet, so it cannot reach a pseudo-element. They are `aria-hidden` spans, which is why
  `content: ''` is not reproduced and why `position`, `left`, `top`, the 7px box, the radius and the
  2px ring are all declarations the reference states on the pseudo-element and this package states
  on a real one.
- **The node's 1px hairline ring is a Tailwind shadow.** Tailwind routes every shadow through its
  `--tw-shadow` composition chain so ring, inset and drop shadows can stack, so the compiled value
  is a variable list rather than `0 0 0 1px var(--border-hairline)`. The token reaching it is
  asserted in `Timeline.test.tsx`.
- **`border-solid` states the style on all four sides where the reference states one.** Tailwind has
  no one-sided border-style utility. The other three sides are zero-width so nothing is drawn, but
  the declaration is real, and it is named in `ADDITIONS` for `.p13-req`, `.p13-audit`,
  `table.data-table th`, `td.mono` and `td.amt` rather than quietly tolerated.
- **Panel headings state their own weight.** The reference leaves `.case-resolution h4` and
  `.timeline h4` to inherit from its global `h1,h2,h3,h4` rule. T-012 deferred element defaults to
  T-017 and this package still ships none, so each heading carries `font-semibold`. `.case-header h4`
  is the exception — the reference declares `font-weight: 600` on it — and so is not listed.
- **Icons are wrapped in a sized, coloured span.** The reference strokes each `svg` directly
  (`.ai-label svg`, `.policy-cite svg`, `.rq-icon svg`). Here a wrapper carries the size and the
  colour and the icon inherits through `currentColor`, which is what lets a screen pass any icon it
  likes. The wrapper adds `flex-shrink` (it must not collapse in a flex row) and, inside the 28px
  evidence tile, `display` (a `span` is inline until it is told otherwise).
- **`<Timeline>` is an `<ol>` and `<EvidenceMatrix>` is a `<ul>`,** where the reference uses `div`s.
  Order is the content in a case timeline, and a reviewer wants to be told how many evidence rows
  there are before reading any. That costs one `list-style-type` declaration.
- **The case header is a `<div>`, not a `<header>`.** HTML-AAM maps a `<header>` scoped inside a
  sectioning element to `generic`, so the two are equivalent by spec. Only by spec: Testing Library
  still reports a scoped `<header>` as `banner`, and an ops console has exactly one banner — the app
  shell's, which is T-013's. A case header that any tool might read as a second one is not worth it.
- **The search field's font-family is Tailwind's `font-body`, not the bare token.** The reference
  names `var(--font-body)` on the input because a form control does not inherit the page face.
  `font-body` is that same token; Tailwind emits it with its own font-feature and font-variation
  resets attached, so the declaration is a longer string that means the same thing.
- **`.search-box` is a `<label>`.** Wrapping the input in its label is what lets the field be named
  without a generated id, which is what keeps `FilterBar` free of `useId`. A label is inline until it
  is told otherwise, hence one `display` declaration the reference's `<div>` did not need.

## Not reproduced at all

- **`.evidence-item`** — N2's left-hand "What we know" panel: a 32px tone-coloured circle beside a
  bold line and a caption. T-014 was asked for `EvidenceMatrix` (pass/gap/check) and
  `Timeline`/`TrustTrail`; this is a third shape. N2's story uses `Timeline` and the review names the
  difference.
- **`.p13-state` as a standalone lifecycle badge.** It is implemented — it is what `EvidenceMatrix`
  draws for Pass / Gap / Check — but it is not exported, so a case header that wants the reference's
  indigo "Verifying" pill has no component for it. `<Chip>` has no indigo tone. Closing this belongs
  with whoever owns `Chip`.
- **`.p13-audit` as a standalone block** (TO-PA2's reviewer assignment) and **`.p13-danger`** (the
  activation guard). Both are screen furniture for T-147. The `.p13-audit` treatment itself ships, as
  the emerald rule under `TrustTrail`'s caption.
- **The `▾` on the reference's "Custom range" chip.** It is a disclosure affordance for a menu that
  `PeriodFilter` does not open — it reveals whatever `customRange` the caller passes, in place. A
  chevron that opens nothing is worse than no chevron.

## Added beyond the reference, deliberately

- **The advisory is a named `region` landmark and its children are typed `string`.** The reference
  draws three sibling `div`s; to a screen reader that is one undifferentiated run of text ending in
  three buttons. See the T-014 ticket note for the whole argument.
- **The action group is `role="group"`, named, and `aria-describedby` the divider and the citation.**
- **`PeriodFilter` is a `radiogroup` with roving tabindex**, not five `aria-pressed` chips. Five
  toggles tell a reader there are five independent switches when there is one choice.
- **`DataTable` requires a `caption`** and scopes every column header.
- **Runtime guards:** no actions on a `DecisionPanel`, no rows on an `EvidenceMatrix`, no events on a
  `Timeline` and no advice in an `AdvisoryBox` all throw rather than render an empty shell.
