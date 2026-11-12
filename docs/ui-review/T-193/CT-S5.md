# CT-S5 — Sent — waiting for the buyer (T-193)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3578
- **Built:** http://localhost:3118/trade/new
- **State shot:** sent
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 44,616 of 224,400 (19.88%) · content only (shell rows blanked) 18.66%
- **Side by side:** `CT-S5.png` (reference · built · heat map) — **heat map:** `CT-S5.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; `ScreenHeader` stands in for the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) sit above the real tab bar, and the stage rail is drawn under the header. The shot walked the real screen in a browser against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides.

**Real differences (intended, and why)**

- **The high score is a shot offset, not a layout fault.** The sent page has no stage rail, and the built shot starts at `main` below the app header (Komtru mark and Buy/Sell switch), pushing every block about 60px down against the reference; each line then diffs against its neighbour. Order, copy and components match.
- **The Trade Code** is the platform's own (`KMT-90432-NG`); the reference's is a shorter placeholder. Copy copies the code and Share opens the platform link (or copies it).
- The timeline is the kit's; its steps name the buyer ("Amaka O. chooses how to receive it") where the reference says "Amaka".
