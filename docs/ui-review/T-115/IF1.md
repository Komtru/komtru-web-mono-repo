# IF1 — Device Flagged (T-115)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3775 — IMEI Verification — Mobile Web · Extends Create Trade
- **Built:** http://localhost:3101/trade/0190b0a0-0000-7000-8000-000000000004
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 47,026 of 224,400 (20.96%)
- **Side by side:** `IF1.png` (reference · built · heat map) — **heat map:** `IF1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome (every screen here).** The reference draws these as full-screen mobile frames with their own
top bar and a pinned footer, and no tab bar. The built screens sit inside `AppShell` (the brief says to use
it), so each carries the shell's brand row with the Buy/Sell switch above it and the tab bar below it, and its
own back/title row is drawn in the content. That is the largest part of every heat map and is intended. Actions
are in the page flow (`ActionStack`) rather than `.btn-sticky`, because a pinned footer would sit on the tab bar.

**Shot against a stub.** The harness shot ran against the real app with a canned stand-in for the backend
(trade ids mapped to states) because no backend runs in the review environment; copy and layout are the real
screens, the data is illustrative.

- **No IMEI.** IMEI capture and verification are F-020 (post-MVP) and the platform produces no flagged-device result, so the IMEI field, "This device is flagged", "Reported lost or stolen" and "Choose a different device" are not drawn. The built screen is IF1's layout (a risk mark, a warning banner that says it is not automatically the person's fault, the way out) for the other end a reviewed proposal can reach that the backend already models: `REJECTED`, "This proposal can't go ahead".
- **No reason is shown** because the trade view carries none. The banner says reviews look at the trade, not only the people in it.
- **Actions** are "Start a new trade" and "Back to your trades"; "Report this listing" needs listings.
- The banner uses the lock mark rather than the reference's alert mark.
