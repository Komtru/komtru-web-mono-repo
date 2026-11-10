# AB3 — Verifying Payment (T-117)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4550 — Escrow Funding — Loading & Failure States — Mobile Web
- **Built:** http://localhost:3115/trade/0190b0a0-0000-7000-8000-000000000003/fund
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 5,353 of 224,400 (2.39%)
- **Side by side:** `AB3.png` (reference · built · heat map) — **heat map:** `AB3.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** As in T-116: the built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of every heat map. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to payment states, one proxy adding the sealed session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, reference and timestamps differ from the drawing for that reason only.

**Real differences (intended, and why)**

- **"Confirming your payment" / "Checking with Paystack"** for "Confirming your transfer" / "Checking with Providus Bank": the screen also serves card and USSD payments, and the app does not know which bank Paystack's one-time account is at.
- **No "This is taking a while — get help" button.** Support is F-047; no dead control is drawn. A line says the buyer can leave the page and the trade updates when the payment is confirmed (the status is polled every 4 s, and the workspace follows the FUNDED push).
- **A top bar with a way back** to the trade, which the reference's loading frame does not draw.
