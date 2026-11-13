# PM-6 — Active trade — the evidence trail (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11301 — Trade execution · Proof media
- **Built:** http://localhost:3130/trade/0190b0a0-0000-7000-8000-000000000001/evidence
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 49,107 of 224,400 (21.88%)
- **Side by side:** `PM-6.png` (reference · built · heat map) — **heat map:** `PM-6.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Hosted by F-028's evidence page** (`/trade/<id>/evidence`, which already uses `DeliveryPage`/`TradeGate` and is linked from the workspace and Add evidence); this ticket supplies the body, `Trail`. Its intro line, the evidence-flow note and the Back button are F-028's.
- **Groups the platform can state.** "Seller's proof" ("Shown when the Trade was agreed" with the agreed time; anything added after sits beside it), "Added by the seller · dispatch" (waybill number and time; the waybill photo only for the seller, since the platform grants it to them alone, and the buyer is told it is kept private), "Added at delivery" (the delivery records, as rows). The reference's hub scan group and the inspection photos are not drawn: none exists on the platform. The buyer sees a line saying inspection photos aren't kept with the Trade yet.
- **The reference's "can't be changed or removed" is not stated**: the app enforces no such rule on the page. The trade code is not drawn in the header (`ScreenHeader` has no right-hand slot).
- Before the item ships the page says evidence appears once it has shipped (F-028's wording).
