# PM-7 — Inspection — compare with the seller’s proof (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11316 — Trade execution · Proof media
- **Built:** http://localhost:3130/trade/0190b0a0-0000-7000-8000-000000000001/inspect
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 54,810 of 224,400 (24.43%)
- **Side by side:** `PM-7.png` (reference · built · heat map) — **heat map:** `PM-7.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Order.** The reference puts the countdown, the two pills, the proof grid and "Does it match?" in one run. The built screen keeps the existing Inspect & Confirm header, window and item summary above, then the pills, the compare, the delivery evidence, then the four checks. The title is the existing v2 Customer-4 "Inspect & Confirm".
- **"My photos" stay on the device.** The platform has nowhere to keep a buyer's inspection photos, so they are a compare aid, and the screen says they aren't sent to Komtru. Their previews are released when removed or when the screen goes. The shot shows the Seller's proof pane (the default); the My photos pane is covered by component tests.
- **The pills** are toggle buttons and the four checks are checkboxes in the reference's selectable rows; they are a reminder and do not gate Confirm & release payment, which keeps its existing acknowledgement.
- "Report an issue" is still "not in the app yet" (F-027), so it is a line of text, not a button.
