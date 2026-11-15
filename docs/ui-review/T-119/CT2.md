# CT2 — Trade Cancelled (T-119)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4275 — Cancel a Trade — Mobile Web
- **Built:** http://localhost:3132/trade/0190b0a0-0000-7000-8000-000000000302
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 6,720 of 224,400 (2.99%)
- **Side by side:** `CT2.png` (reference · built · heat map) — **heat map:** `CT2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts and dates are illustrative. Every amount on the built screen is the stand-in's refund row or trade snapshot, rendered as sent.

**Real differences (intended, and why)**

- **Says only what the status proves.** The reference says "TechEdge NG has been notified. Since no funds were ever protected, there's nothing left to settle." The built screen says the other side has been notified only for the person who just cancelled. It says "Komtru never confirmed a payment on this trade, so there is nothing to settle" only to a buyer whose own payment status reads `NONE` or `AWAITING_PAYMENT`; a payment that is verifying, confirmed, under review or not confirmed is told "may have reached Komtru after it was cancelled" and to contact support with the trade code; the seller, and a buyer whose status is loading or unreadable, are told only that the trade was cancelled before it was funded.
- **No "won't appear on your Trust History" line.** No spec or platform field backs it.
- It is a state of the trade page (`/trade/[id]` when the agreed trade is `CANCELLED`), reached right after CT1 on the cancel route as well.
