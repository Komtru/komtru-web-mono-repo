# AC1 — My Trades — Empty State (T-113)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 2637 — Empty State & Password Reset — Mobile Web
- **Built:** http://localhost:3001/home
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 14,682 of 224,400 (6.54%)
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

**Live app, F-015 (2026-11-15).** Shot at `/home` with no trades, full page, signed in through a sealed session against a scratch stand-in for the platform.

- The shot is the Home tab, so the bottom bar highlights Home where the reference highlights Trades. Intended: the empty Home is the AC1 panel, and Home is where a new user lands.
- The H-03 info banner (“Agree on the details…”) sits under the buttons. AC1 does not draw it; H-03 does, and it is the same state. Intended.
- The page's one `h1` is screen-reader only, because the reference draws no heading over the panel. Intended.
- The panel, its wallet icon and both buttons match the reference's order, copy and position. What is left is the top band (the app's own shell bar, a brand and a Buy/Sell switch, where the reference draws a logo row with a bell and an avatar) and the bottom tab bar's active item. Intended until the shell changes, which is T-013's.
