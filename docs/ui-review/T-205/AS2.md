# AS2 — Account Suspended — Seller (T-205)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 7258 — Trust History · Account · Notifications — Mobile Web
- **Built:** http://localhost:3146/shop/suspended
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 12,401 of 224,400 (5.53%)
- **Side by side:** `AS2.png` (reference · built · heat map) — **heat map:** `AS2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar. The shot ran against `next dev` and a canned stand-in for the platform routes (one proxy adds the sealed session cookie), so names, references and dates are illustrative. The naira sign and fonts are as the harness README describes.

**Real differences (intended, and why)**

- The reference's lead names "an unusual pattern of new-account proposal activity". The platform does not say why, and no seller is told a cause that may not be theirs, so the lead reads "an unusual pattern of activity". Intended; raised in the report.
- The paused rows come from the platform's own `abilities` (selling, withdrawing), not from the state's name: "Create listings" and "Accept new Trade requests" read Paused when `sell` is false; "Ship or withdraw" reads Unaffected unless `withdraw` is false.
- Shown in the Account frame, because the reference marks Account as the current tab.
