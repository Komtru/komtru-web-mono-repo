# CR3 — Refund Issued (T-119)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4378 — Cancel After Funding — Mobile Web
- **Built:** http://localhost:3132/trade/0190b0a0-0000-7000-8000-000000000306
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 9,130 of 224,400 (4.07%)
- **Side by side:** `CR3.png` (reference · built · heat map) — **heat map:** `CR3.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts and dates are illustrative. Every amount on the built screen is the stand-in's refund row or trade snapshot, rendered as sent.

**Real differences (intended, and why)**

- **"Issued" only when the refund is `PROCESSED`.** The built screen reads the trade's refund row. `REQUESTED` and `PROCESSING` read "Refund on its way" and "is being sent back"; `FAILED` and `NEEDS_REVIEW` read "Your refund hasn't completed" with "Your money is held by Komtru, not lost", the platform's own reason and the refund reference; no refund row says nothing about money. Extra shots of the on-its-way, held and no-row states are listed in the README.
- **The amounts are the ledger's, as sent.** The hero and "The refund" rows show the refund total, the item amount, and the buyer protection fee with what the platform did with it ("Returned with your refund" or "Kept by Komtru"). Nothing is added up or subtracted on the screen. The fee row is dropped when its amount is zero.
- **No "Usually arrives within 2 hours, always within 24".** No platform field promises an arrival time, and the refund's bank timing is the bank's.
- **The status chip reads "Cancelled", not "Refunded".** The status means the ledger decided a refund, not that the money has gone back; the same chip is used in the trades list.
- A trade overview state (`CANCELLED_REFUNDED`), inside the workspace header and tabs the reference does not draw.
