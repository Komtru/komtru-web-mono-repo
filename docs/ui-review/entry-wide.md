# Entry screens with no wide drawing (F-067, F-072)

The reference draws DX-01 and TX-01 only. Every other entry screen is drawn on a phone, so these have no frame to
score against; each was captured at 1280 and 820 through the stand-in (`pnpm visual-capture`) and read by eye, and
every entry route was loaded in `next start` at 1280, 820 and 390 with no console or hydration error (the only
errors are the stand-in's 404s for the terms and states reads, which also occur at 390).

Frame, by owner decision: **desktop = DX-01's two columns** (brand story and Trade Code entry on the left, the
screen's phone content and actions on the right, actions stacked under the form, no sticky footer); **tablet =
TX-01's centred card** (wordmark above, actions under the form side by side, a Back link in the card in place of the
top bar); **phone unchanged**.

| Screen                                                                         | 1280                                                                                           | 820                                                                | Notes                                                                                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 Welcome `/`                                                                 | right column: graphic, copy, both buttons; the headline is the page's `h1`, in the brand panel | card: logo, graphic, headline, copy, both buttons, Trade Code line | body chosen by width (no state)                                                                                                                     |
| E2 Sign up                                                                     | form and Continue in the column                                                                | card, Trade Code line                                              |                                                                                                                                                     |
| TOS1, full Terms, TOS2                                                         | read                                                                                           | read                                                               | 280px terms box kept                                                                                                                                |
| E3 / E3b Verify                                                                | six cells and Verify                                                                           | card                                                               | needs a code in the draft; with none it returns to sign up, as on a phone                                                                           |
| AC2, AC3, set password                                                         | form and action                                                                                | card                                                               | set password and TOS2 need a session and a platform read the stand-in lacks, so they were captured as the stand-in answers (TOS2 shows "Try again") |
| SP-M14 status, SP-M15 update, SP-M16 session expired, SP-M17 too many attempts | column                                                                                         | card                                                               |                                                                                                                                                     |

Deviations and decisions for the owner:

- **Trade Code on desktop is on every entry screen**, as asked; on tablet only on log in, welcome and sign up. A logged-out visitor cannot see a trade from a code (the platform lookup needs a session), so the box says they log in first. See DX-01.md.
- **Keep me signed in** is not built; see DX-01.md.
- On tablet the buttons of every screen sit side by side at their own width (TX-01's pattern); long labels wrap onto a second row rather than shrink.
- Not checked in a browser: TOS2 and set-password with real data (the stand-in has no terms or session read for them); both are covered by the jsdom suites at all three widths.
