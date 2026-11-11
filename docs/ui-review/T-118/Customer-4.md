# Customer-4 — Confirm Delivery (T-118)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4061 — Customer (Buyer) — Mobile Web
- **Built:** http://localhost:3128/trade/0190b0a0-0000-7000-8000-000000000201/inspect
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,309 of 224,400 (9.94%)
- **Side by side:** `Customer-4.png` (reference · built · heat map) — **heat map:** `Customer-4.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts, dates and photos are illustrative.

**Real differences (intended, and why)**

- **Same screen as Z4.** Customer-4 is the earlier drawing of Inspect & Confirm; Z4 extends it with the seller's proof, and one route (`/trade/[id]/inspect`) is both. The deviations are Z4's.
- **The "I have it" step** that starts inspection is on the trade overview (AB1 shot), not here: this screen opens once inspection has started.
