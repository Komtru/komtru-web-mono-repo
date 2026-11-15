# AR1 — Trade Auto-Released (T-119)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4294 — Cancel a Trade — Mobile Web
- **Built:** http://localhost:3132/trade/0190b0a0-0000-7000-8000-000000000303
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,893 of 224,400 (10.20%)
- **Side by side:** `AR1.png` (reference · built · heat map) — **heat map:** `AR1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts and dates are illustrative. Every amount on the built screen is the stand-in's refund row or trade snapshot, rendered as sent.

**Real differences (intended, and why)**

- **Shown as a banner on the finished trade, not as a full screen.** It appears on `COMPLETED` and `SETTLED` trades whose own activity records `INSPECTION_ELAPSED`, so a payment the buyer released by hand never gets it.
- **"Released" is said only when it happened.** While the trade is `COMPLETED` the banner says "is being released"; only `SETTLED` says "was released". The amount is the trade's own fee snapshot (the buyer's item amount, the seller's proceeds), the same figure the Settlement and Complete screens already show. The window length is the trade's own `inspectionWindowHours`, not "24-hour".
- **Not built:** "Still see a problem? You can still report an issue for up to 24 hours" and the "Report an issue anyway" button. Disputes are F-032, and no platform field states a 24-hour reopening window. "Fashion & Luxury's standard, shorter than Electronics" is dropped for the same reason.
- The "Trade complete" hero stays above it, because AR1 is a state of that screen.
