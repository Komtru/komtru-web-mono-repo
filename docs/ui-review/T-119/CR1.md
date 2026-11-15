# CR1 — Request Cancellation (T-119)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4328 — Cancel After Funding — Mobile Web
- **Built:** http://localhost:3132/trade/0190b0a0-0000-7000-8000-000000000304/cancel
- **Frame:** mobile, 340px reference frame; compared at 340 × 728
- **Differing pixels:** 24,570 of 247,520 (9.93%)
- **Side by side:** `CR1.png` (reference · built · heat map) — **heat map:** `CR1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts and dates are illustrative. Every amount on the built screen is the stand-in's refund row or trade snapshot, rendered as sent.

**Real differences (intended, and why)**

- **No amount and no 12-hour clock.** The reference's banner names the refund amount and the term row says "12 hours to respond". The refund amount is the ledger's (it applies the buyer protection fee rule), so this screen states none; and there is no 12-hour response limit or auto-approval in the platform (an owner question on the backend plan), so the rows say "Seller can: Agree or decline", "If they agree: Your refund starts automatically", "If they decline: Your payment stays protected", and keep "If they've already shipped: This request won't be available".
- **No reason is preselected.** The reference marks "Changed my mind" chosen; here the button stays disabled until the buyer picks one, so a reason is never sent that the buyer did not choose.
- **The screen follows the platform, not the route.** The button is drawn only when the cancellation read says `canRequest`. A waiting request, a declined one (with the seller's note), a refund already requested, a shipped trade, a held trade and an already-refunded trade each say so in words with no control.
- Send is one request per decision: the idempotency key is kept across a retry after a lost answer and replaced only after a definite refusal.
