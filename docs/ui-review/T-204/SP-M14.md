# SP-M14 — Service notice (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7492 — Supporting · System states
- **Built:** http://localhost:3146/status
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 12,158 of 224,400 (5.42%)
- **Side by side:** `SP-M14.png` (reference · built · heat map) — **heat map:** `SP-M14.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen is the entry frame (`EntryFrame`, ui-kit's `MobileShell`) with no app shell, shot with `--content [class*=max-w]` so the shot starts at the frame. The reference's top bar is drawn by the frame; its sticky footer is the frame's `StickyFooter`. The shot ran against `next dev` and a canned stand-in for the platform routes, so times and references are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **There is no incident feed**, so the page does not announce one. It asks the platform a small public question (the list of states, which needs the database) and says what the answer was. Shot with the canned platform answering 503 ("Komtru is having trouble"); an answer shows "Komtru is working", and no network shows "You're offline" with a different explanation (the device, not us).
- **The reference's incident copy is not drawn:** "Some bank payments are taking longer", "We're waiting on confirmations from banks", "Nothing is lost, and nothing is charged twice", "Your Trades keep their deadlines paused", and "See my affected Trades (2)". Only an incident feed could know a cause, a list of affected Trades or that deadlines are paused; the platform has none of those. What stays is true of any outage: it is not the person's doing; money already held for a Trade stays held; a payment already made should not be made again before the Trade is checked.
- The strip says "Checked 17:00", the time of this check, not "Updated 14:30", because there is no update to report. **Check again** asks again.
- Reached by any 503 from a read or a change anywhere in the signed-in app: a strip appears in the shell ("Komtru is having trouble · See what's happening") and goes at the next successful read. See `test/system-reach.test.tsx`. The route `/status` is open to anyone, signed in or not.
- Loading, working, trouble and offline are held by `test/system-states.test.tsx`, each with an axe pass.
