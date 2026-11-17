# SP-M19 — Link expired or Trade not found (T-204)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7580 — Supporting · System states
- **Built:** http://localhost:3146/trades/KMT-0000000-NG
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 30,497 of 224,400 (13.59%)
- **Side by side:** `SP-M19.png` (reference · built · heat map) — **heat map:** `SP-M19.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Trades (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- **How it is reached:** a 404 on a Trade Code (`/trades/<code>`), on a trade (`/trade/<id>`) and on the trade-sheet screens that read the trade first (documents, evidence, delivery, inspection record). The platform answers a code that does not exist and a trade that is not this person's the same way, and so does this screen: it says neither, and offers no retry. A 500 is still a retryable error, not this screen.
- The reference's URL is `/t/KMT-000000`. There is no `/t` route; a shared Trade link is `/trades/<code>` and lands here when it opens nothing.
- **Enter a Trade Code** goes to the find screen (`/find`). **Contact support** shows the account's support reference (the inbox, SP-M06, is T-129's) and is not drawn when the reference cannot be read, so there is never a button that opens nothing.
- Added one line for someone who was invited: sign in with the phone number or email the invitation used.
- The warning mark is a triangle in a neutral ring, as the reference draws it. "Komtru never asks you to pay from a link" is kept: payment is only ever made inside the app's own checkout.
- **Not wired:** the trade action screens that read a trade for themselves (propose change, ship, inspect, request more time, fund, complete a request) still say it in their own error panel on a 404. They were not changed; wiring them is the same one-line change.
- This replaces the earlier "No trade found for you" panel on a Trade Code. Held by `test/system-states.test.tsx`, `test/system-reach.test.tsx`, `test/trade-by-code.test.tsx` and `test/trade-screen.test.tsx`, with axe.
