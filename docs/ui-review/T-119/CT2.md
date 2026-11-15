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

- **Says only what the status proves.** The reference says "TechEdge NG has been notified. Since no funds were ever protected, there's nothing left to settle." The built screen says the other side has been notified only for the person who just cancelled, and "Komtru never confirmed a payment on this trade, so there is nothing to settle" (a funded trade is refunded, never `CANCELLED`). For the buyer it adds a line to keep the receipt and contact support with the trade code if they did send a payment, because a transfer can land after a cancel.
- **No "won't appear on your Trust History" line.** No spec or platform field backs it.
- It is a state of the trade page (`/trade/[id]` when the agreed trade is `CANCELLED`), reached right after CT1 on the cancel route as well.
