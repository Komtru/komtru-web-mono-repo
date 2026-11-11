# Seller-3 — Ship Order (T-123)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 5589 — Seller — Mobile Web
- **Built:** http://localhost:3126/trade/0190b0a0-0000-7000-8000-000000000102/ship
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 19,389 of 224,400 (8.64%)
- **Side by side:** `Seller-3.png` (reference · built · heat map) — **heat map:** `Seller-3.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of every heat map. The shot ran against the real production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so the data is illustrative: trade codes, names, amounts and dates differ from the drawing for that reason only. The shell is drawn for the anonymous viewer (Buy mode) because the viewer seam (`resolveViewer`) is not filled yet.

**Real differences (intended, and why)**

- Seller-3 (Ship Order, "Courier / Tracking number / optional photo") and X2 are the same built screen. The platform requires X2's four fields (waybill number, receipt photo, driver phone, plate), so Seller-3's looser form (courier name, optional photo) is not built; see X2.
- The "Due today" banner is the delivery deadline strip ("Ship by").
- Item card as in X1; the reference's "To: buyer, area" is not on the trade view.
