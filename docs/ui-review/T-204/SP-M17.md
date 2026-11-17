# SP-M17 — Too many attempts (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7543 — Supporting · System states
- **Built:** http://localhost:3146/login
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 4,878 of 224,400 (2.17%)
- **Side by side:** `SP-M17.png` (reference · built · heat map) — **heat map:** `SP-M17.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen is the entry frame (`EntryFrame`, ui-kit's `MobileShell`) with no app shell, shot with `--content [class*=max-w]` so the shot starts at the frame. The reference's top bar is drawn by the frame; its sticky footer is the frame's `StickyFooter`. The shot ran against `next dev` and a canned stand-in for the platform routes, so times and references are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- Shot through the real sign-in: a canned 429 with `Retry-After: 872` after typing a number and password, which is the reference's 14:32. The clock counts down once a second; the shot caught the first frame.
- **The clock is the platform's `Retry-After`.** With none, no clock is drawn and nothing is promised about time (held by `test/entry-screens.test.tsx`).
- Added **Back to log in**, held until the clock reaches zero, so the person is not handed a form to hammer.
- **"Contact support" is not drawn.** There is no support inbox yet (SP-M06 is T-129's) and a signed-out person has no reference to give. **Recover my account** goes to the password reset, the one recovery a signed-out person has.
- **How it is reached:** a 429 on sign-in, and a 429 on the second-factor code step, replace the form with this screen (`LoginForm`). The code-sending 429s (resend) and the other forms' limits (verify, password reset, sign-up) still say it in a line of text on their own screen; they are not this screen.
- The ring is a neutral ring with an alert mark, as the reference draws it.
- Held by `test/system-states.test.tsx` and `test/entry-screens.test.tsx`, with axe.
