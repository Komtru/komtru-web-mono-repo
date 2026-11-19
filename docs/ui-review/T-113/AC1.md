# AC1 — My Trades — Empty State (T-113)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 2637 — Empty State & Password Reset — Mobile Web
- **Built:** http://localhost:3913/trades
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,768 of 224,400 (10.59%)
- **Side by side:** `AC1.png` (reference · built · heat map) — **heat map:** `AC1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

Shot by the harness (`pnpm visual-check --screen AC1 --walk <app origin>`) against the production build of `apps/web-app-ui`
and the canned stand-in: signed in as the `buyer` persona with the `no-trades` scenario, clock pinned to 2026-11-19 09:00 UTC,
`/trades`, full page from the top. The shell is not cropped, so the header band takes part in the comparison.

**Real differences, not yet judged** (the reference is the target; whether the copy or the design wins is the owner's call)

- **Heading and lead copy.** The reference says "No protected Trades yet" and "Start one, or enter a Trade Code from a seller — every completed Trade adds to your Trust Profile." The built screen says "No protected trades yet" and "Start one with a seller or a buyer. Every completed trade adds to your Trust Profile."
- **Actions.** The reference draws two buttons, "Start a Trade" and "Enter a Trade Code". The built empty state draws one, "Start a trade". The reference's second button is missing from the built screen.
- **Brand mark.** The reference draws the bold `komtru-wordmark` image in the logo row. The built header draws the share icon and a lighter "Komtru" set in text.
- **Header controls.** The reference draws a bell (`.tb-icon`) at the right of the logo row. The built header on this route draws the Buy/Sell mode switch instead, and no bell. On `/home` the bell is present (earlier probe), so this follows the route.
- **Vertical offset.** The built card starts about 14px above the reference's, which moves every line of copy in the panel by the same amount. Most of the remaining heat sits on the copy, so the offset compounds the copy difference.

**Matched** — the tab bar (Trades active, the same five labels and icons) and the panel's wallet icon in its circle.

**Method.** These are facts about the built app at this commit. Re-run the check after the copy or the action set changes. A re-run refreshes the metadata above the comment and keeps this list, so update the list by hand.

### Earlier reviews

The next two blocks are the hand-rolled reviews recorded before the harness existed. They were written against `/home`, a different route, with a different stand-in, and they are kept verbatim.

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
