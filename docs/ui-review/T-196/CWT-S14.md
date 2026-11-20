# CWT-S14 — Resolution — Report an Issue (T-196)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11110 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3931/trade/0190b0a0-0000-7000-8000-000000000503/dispute
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,607 of 224,400 (10.07%)
- **Side by side:** `CWT-S14.png` (reference · built · heat map) — **heat map:** `CWT-S14.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Scenario:** `with-trades`, buyer, the trade in inspection, `/trade/<id>/dispute`. Same component and route as Customer-7.

- **Shell offset (standing).** The built screen sits under the app shell's Komtru bar (about 28px) and above the tab bar with its raised plus action; the reference frame draws neither, and its action is pinned (`.btn-sticky`) where the built one is in the page flow. Every line below the title therefore sits lower than in the reference, which is most of the heat map on every screen here. Not a defect of this screen.
- **Term rows.** The built list is Trade / Amount / Funds. The reference's Inspection row ("Active · 48h minimum") is not drawn; the screen has not read the inspection window. Intended (README).
- **Reason list, preselection, description.** As Customer-7: DI-01's vocabulary, nothing selected, "Tell us what happened" below. The reference list is "Item not as described / never arrived / arrived damaged / Something else".
- **Figures.** ₦64,000.00 and KMT-88262-NG (fixture) against ₦195,000 and KMT-90428.
- **Actions.** "Continue to issue review" and "Back to trade" are in the page flow below the form; the reference pins both.
