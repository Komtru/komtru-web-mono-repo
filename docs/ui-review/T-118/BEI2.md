# BEI2 — Buyer Wants More Time (T-118)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3715 — Trade Standards by Category — Mobile Web
- **Built:** http://localhost:3128/trade/0190b0a0-0000-7000-8000-000000000202/inspect
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 32,887 of 224,400 (14.66%)
- **Side by side:** `BEI2.png` (reference · built · heat map) — **heat map:** `BEI2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts, dates and photos are illustrative.

**Real differences (intended, and why)**

- **BEI2 is on the inspection screen, not a proposal.** The reference shows the buyer's ask inside a new proposal ("include with my proposal"). The platform's (T-065) ask is made during inspection, once, so the seller answers it here, beside the countdown and the item.
- **Accept or Decline, not "Counter with 48h standard".** The platform has no counter; declining leaves the original window.
- The request shows the hours asked for as "24 hours more" against "48 hours standard", with the buyer's note as a row.
- No strikethrough on the standard; both are plain rows.
