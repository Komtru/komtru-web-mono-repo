# CWT-02 — Workspace — Funds Protected (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10637 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000002
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,951 of 224,400 (10.23%)
- **Side by side:** `CWT-02.png` (reference · built · heat map) — **heat map:** `CWT-02.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **No "Prepare & dispatch" button and no dispatch method or route rows.** Shipping is F-026; the screen says "Marking the item shipped isn't in the app yet" and draws no control. The method (Courier) and route come from the dispatch flow.
- **"Dispatch target · Today, 18:00" is "Ship by · <date and time>".** The platform records the delivery deadline, not a daily target; the date is the delivery deadline's `dueAt`, in Lagos time.

**Real differences**

- Tab strip, item line and stacked actions as in CWT-01.
- **"Seller payout · Held — not yet released" is "Your payout · ₦195,000 · held, not yet released"** because the reader is the seller and the platform has the amount (fee snapshot).
- The reference's "View agreed terms" button is a secondary button below the content, as drawn; "View activity" is added beside it.
