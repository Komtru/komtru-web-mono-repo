# CT-S6 — Choose how to receive it (buyer) (T-193)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3601
- **Built:** http://localhost:3118/trade/<id>
- **State shot:** buyer chooses, Courier selected
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 24,865 of 224,400 (11.08%) · content only (shell rows blanked) 5.04%
- **Side by side:** `CT-S6.png` (reference · built · heat map) — **heat map:** `CT-S6.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; `ScreenHeader` stands in for the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) sit above the real tab bar, and the stage rail is drawn under the header. The shot walked the real screen in a browser against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides.

**Real differences (intended, and why)**

- **Park is drawn "Coming soon"** and Courier is the only live mode (O5), so the reference's Park-selected state is not reached; the "If you choose Courier" block is shown as "Delivering to" with the buyer's saved addresses and an Add-a-new-address action.
- **Title line is the seller's brand and model** with the item's reference as sub-line; the reference's "256GB, Sierra Blue" line is the Electronics example.
- Courier cost and partner ("SwiftDrop · estimated 5–7 days") are what the seller committed, not a calculated list. The action is "Review agreement".
