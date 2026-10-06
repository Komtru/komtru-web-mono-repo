# NAV — Persistent responsive left pane (T-140)

- **Reference:** `docs/design-reference/Komtru — UI Screens Living Master File.html` line 8204 — TrustOps Console — Park Agents · Desktop + Tablet
- **Built:** http://127.0.0.1:6013/iframe.html?id=shells-consoleshell--park-agents&viewMode=story
- **Frame:** desktop, 1040px reference frame; compared at 1040 × 620
- **Differing pixels:** 6,691 of 644,800 (1.04%)
- **Side by side:** `NAV.png` (reference · built · heat map) — **heat map:** `NAV.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

Shot for **T-013** (`ui-kit` layout shells) against Storybook story `Shells/ConsoleShell` →
`ParkAgents`. The whole left pane, the `.ko-nav-divider`, the `.ko-page-head` and the content
padding are this ticket's; the two stat cards are stand-in content. T-140 owns the screen.

**Shell chrome (T-013)**

- **The reference's own brand mark has no size.** `.ko-dweb-sidebar .ds-logo` declares no `svg`
  rule, so the reference's `<svg>` fills its box and draws the Komtru mark at roughly 56px.
  `<ConsoleShell>` draws it at the 16px every other lockup in the file uses. Intended; it is the
  single largest block of flagged pixels on this screen.
- The reference's rail glyphs are text characters (`▦ ◌ □ ◎ ⌁`); the story passes line icons, which
  is what a console ships. Intended.
- The rail is 228px, the content `24px 28px 28px`, per the rules — the section's prose says "180px
  sidebar, 24px content padding", and the rules are what the screens are drawn against.
- The sheet collapses the rail at `@media(max-width:900px)`; the shell collapses it at `lg` (1024),
  which is the ticket's scale. Not visible here — NAV is drawn in a desktop frame.

**Content, for whoever builds the screen (T-140)**

- `.btn-primary` is `width:100%`; the page-head button is written `width:auto`. The story
  shrink-wraps it in an `inline-flex` parent.
