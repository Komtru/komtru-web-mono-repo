# AC1 — My Trades — Empty State (T-113)

- **Reference:** `docs/design-reference/Komtru — UI Screens Living Master File.html` line 2328 — Empty State & Password Reset — Mobile Web
- **Built:** http://127.0.0.1:6013/iframe.html?id=shells-mobileshell--trades-empty&viewMode=story
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 16,627 of 224,400 (7.41%)
- **Side by side:** `AC1.png` (reference · built · heat map) — **heat map:** `AC1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

Shot for **T-013** (`ui-kit` layout shells) against Storybook story `Shells/MobileShell` →
`TradesEmpty`. Only `.scr-logo-row` and `.scr-tabbar` are this ticket's. T-113 owns the screen.

**Shell chrome (T-013)**

- **The reference's own logo-row icon has no rule and collapses to nothing.** `.tb-icon` is only
  ever declared as `.scr-topbar .tb-icon`, so AC1's and Z1's bell — which sit in `.scr-logo-row` —
  are unstyled `<div>`s in the reference and render as a zero-height box. `<LogoBar>` gives the
  action the same 32px round control `<TopBar>` uses, which is what the markup clearly intends.
  That makes the built header 18px taller than the drawing, and everything below it shifts down by
  the same amount — which is most of this screen's 7.4%. Intended.
- The tab bar matches: 19px icons, 9px labels, the indigo/trust-gray pair, the hairline, the 8/4/12
  padding.

**Content, for whoever builds the screen (T-113)**

- The reference's two buttons sit below `.state-panel`, not inside it; the story reproduces that,
  but `<EmptyState action>` renders them inside, so the screen should pass them as siblings.
