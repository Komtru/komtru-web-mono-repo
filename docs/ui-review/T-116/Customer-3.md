# Customer-3 — Active Trade (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4033 — Customer (Buyer) — Mobile Web
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000007
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 12,862 of 224,400 (5.73%)
- **Side by side:** `Customer-3.png` (reference · built · heat map) — **heat map:** `Customer-3.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Real differences**

- **Customer-3 is the v2 workspace's funded state for the buyer (CWT-02's buyer view), not a separate screen.** v2 replaced the separate buyer and seller trade screens with one role-aware workspace, so this check shoots the workspace with a buyer's trade in `FUNDED`.
- **The five-row "Trade timeline" is the five-step progress bar and the Activity tab**, not a list on the overview. The drawing's "Next step" paragraph is the green "Your funds are protected" banner.
- **"Seller has 24h remaining" is "The seller ships by · <date and time>"** from the delivery deadline.

**Correctly shows less**

- **No "Message TechEdge NG" button** (messaging is F-044).
