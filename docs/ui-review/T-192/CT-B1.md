# CT-B1 — Start a trade — About (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3283 — Create a Trade · Buyer starts
- **Built:** http://localhost:3118/trade/new
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,672 of 224,400 (10.55%)
- **Side by side:** `CT-B1.png` (reference · built · heat map) — **heat map:** `CT-B1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **Seller field takes a handle, email or phone** (the platform looks a person up by any of the three); the reference shows a phone. The found strip says "Profile found · 342 completed trades"; the reference's "98.7% fulfilment" is not something the platform reports, so it is not drawn.
- **"Where the seller operates from" is not drawn.** The lookup carries no shop address; the reference's card has nothing to read it from.
- **Category.** Detected from the item words, as the reference says; the note is the reference's. When nothing matches, a category picker is shown, because the platform needs one (owner question O1). The reference never shows that case.
- A fee line under the price (the platform's own preview figure) is added.
