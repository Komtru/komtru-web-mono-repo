# CWT-S12 — Evidence — Trade Media (T-195)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11073 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000005/evidence
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 51,686 of 224,400 (23.03%)
- **Side by side:** `CWT-S12.png` (reference · built · heat map) — **heat map:** `CWT-S12.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell`: `ScreenHeader` stands in for the drawn bar, the actions are in-flow (`ActionStack`) above the real tab bar rather than pinned, and the shot clips from `main` so the app header does not offset every line. The shot walked the real screen in a browser against `next dev` and a canned stand-in for the platform routes and the session, so names, codes, times and prices are illustrative. Times are shown in Lagos time as the app words them, so they differ from the reference's fixed examples.

**Real differences (intended, and why)**

- **Groups are Listing, Dispatch, Delivery, Inspection, but only what the platform can list is filled.** Listing is the seller's proof photos (real count); Dispatch is the waybill receipt, shown to the seller only (it is private evidence); Delivery and Inspection have no media read, so they say "No files recorded" with a count of 0 rather than the reference's example counts. Thumbnails are signed-URL images, not grey placeholders.
- **No "Add evidence" button and no empty "+" tile**: the platform has no call to attach evidence to a trade (see CWT-S13). The reference's "Back to trade" and its info banner copy are kept.
- The reference's top-bar chat icon is not drawn (no chat entry from here).
