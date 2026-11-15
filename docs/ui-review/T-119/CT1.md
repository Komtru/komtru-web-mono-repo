# CT1 — Cancel This Trade? (T-119)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4243 — Cancel a Trade — Mobile Web
- **Built:** http://localhost:3132/trade/0190b0a0-0000-7000-8000-000000000301/cancel
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 138,698 of 224,400 (61.81%)
- **Side by side:** `CT1.png` (reference · built · heat map) — **heat map:** `CT1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts and dates are illustrative. Every amount on the built screen is the stand-in's refund row or trade snapshot, rendered as sent.

**Real differences (intended, and why)**

- **A full screen, not a sheet over "Review & Fund".** The reference draws a bottom sheet over a faded funding screen, which is why this one scores 62%. The built screen is its own route (`/trade/[id]/cancel`) so the payment status can be read before the cancel is offered.
- **"No money has moved" is not said.** The platform does not stop a cancel while a bank transfer is on its way, so for the buyer the screen reads the payment status first. No attempt on record: "No payment has been started on this trade, so there's nothing to refund." A payment attempt still open: a warning, and the cancel stays disabled until the buyer ticks "I haven't sent any money for this trade". Verifying, confirmed, under review or not confirmed: no cancel at all, only "Open the trade". Status unreadable: no cancel, with "Try again". The seller cannot read the buyer's payment and is told only "Komtru hasn't confirmed a payment on this trade". See the unit tests in `apps/web-app-ui/test/cancel-before-funding.test.tsx` and the extra shots (awaiting payment, blocked) listed in the README.
- **Optional reason is sent trimmed, or not at all.** Same as the reference's optional field.
- The back arrow goes to the trade, not to "Review & Fund".
