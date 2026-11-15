# SC1 — Cancel — Can't Fulfill (T-119)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4400 — Cancel After Funding — Mobile Web
- **Built:** http://localhost:3132/trade/0190b0a0-0000-7000-8000-000000000307/cancel
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 29,086 of 224,400 (12.96%)
- **Side by side:** `SC1.png` (reference · built · heat map) — **heat map:** `SC1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts and dates are illustrative. Every amount on the built screen is the stand-in's refund row or trade snapshot, rendered as sent.

**Real differences (intended, and why)**

- **No "immediately", no Trust History line.** "This refunds {buyer} immediately" becomes "This refunds {buyer}" (the refund is processed by the payment provider after the decision). The "Repeated cancellations show up in your Trust History" paragraph is dropped: nothing in the platform states it.
- **Asks once.** "Cancel & refund buyer" is disabled until a reason is chosen, then opens a confirmation sheet ("Cancel and refund") before the refund is started; it cannot be undone.
- No reason is preselected (the reference preselects "Out of stock").
- If the buyer has a request waiting, a banner above links to CR2 to answer it instead.
- The button is drawn only when the cancellation read says `canCancelAsSeller`; a shipped, held or already-refunded trade says so with no control.
