# AS2 — Account Suspended — Seller (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7258 — Trust History · Account · Notifications — Mobile Web
- **Built:** http://localhost:3146/shop/suspended
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 11,773 of 224,400 (5.25%)
- **Side by side:** `AS2.png` (reference · built · heat map) — **heat map:** `AS2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- The reference's lead names "an unusual pattern of new-account proposal activity". The platform does not say why, so the lead reads "an unusual pattern of activity". Same reasons and same banner rule as AS1: "What still works" comes from `abilities`, and the reference's "Existing Trades continue normally — you can still ship what's already funded" is not stated, because nothing the platform sends says shipping is unaffected.
- The table is headed **What's paused and what isn't** (the reference's "While this is under review, you can't" sat over rows that could read Available). Rows: Create listings and Accept new Trade requests follow `sell`; **Withdraw funds** (the reference's "Ship or withdraw") follows `withdraw`; shipping is not claimed.
- Shown in the Account frame, because the reference marks Account as the current tab. Reached from Account for a seller (Sell mode).
