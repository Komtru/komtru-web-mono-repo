# CT-S2 — Item details — Electronics (T-193)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3514
- **Built:** http://localhost:3118/trade/new
- **State shot:** stage 2, Electronics
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,125 of 224,400 (10.31%) · content only (shell rows blanked) 3.42%
- **Side by side:** `CT-S2.png` (reference · built · heat map) — **heat map:** `CT-S2.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; `ScreenHeader` stands in for the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) sit above the real tab bar, and the stage rail is drawn under the header. The shot walked the real screen in a browser against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides.

**Real differences (intended, and why)**

- **Fields come from the category's own specification** (brand, model, condition, serial or IMEI, photos); the reference's storage and colour fields are Electronics examples the platform's specification does not fix. Condition is a radio list, not pills, because the kit's choice control is a list.
- **"This is a Fashion & Luxury item" link is not drawn**: the category is detected from the item words, and a picker shows when nothing matches (O1).
- Proof media is mandatory for a seller proposal; the upload card and its notice sit under the photos heading.
