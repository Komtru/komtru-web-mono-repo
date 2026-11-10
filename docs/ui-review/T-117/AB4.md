# AB4 — Payment Not Confirmed (T-117)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4573 — Escrow Funding — Loading & Failure States — Mobile Web
- **Built:** http://localhost:3115/trade/0190b0a0-0000-7000-8000-000000000004/fund
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 51,933 of 224,400 (23.14%)
- **Side by side:** `AB4.png` (reference · built · heat map) — **heat map:** `AB4.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** As in T-116: the built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of every heat map. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to payment states, one proxy adding the sealed session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, reference and timestamps differ from the drawing for that reason only.

**Real differences (intended, and why)**

- **No "Still valid — same account" card or "Copy account again".** C8 again: the account lives in Paystack's checkout, not in the app.
- **"We couldn't confirm this payment" and reworded reassurance.** The reference's "Nothing has been charged" is not something the app can know for a bank transfer that may still land, so the copy says what is known: the money has not been seen, the trade is untouched, and a transfer is usually a bank delay.
- **"Start the payment again" replaces "Contact support · ref KMT-88213".** Support is F-047, so the trade code to quote is printed as a line instead; restarting asks the platform for a fresh reference within its grace rules (T-072) and returns to V1.
