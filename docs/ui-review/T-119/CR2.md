# CR2 — Buyer Wants to Cancel (T-119)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4354 — Cancel After Funding — Mobile Web
- **Built:** http://localhost:3132/trade/0190b0a0-0000-7000-8000-000000000305/cancel-request
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 32,515 of 224,400 (14.49%)
- **Side by side:** `CR2.png` (reference · built · heat map) — **heat map:** `CR2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts and dates are illustrative. Every amount on the built screen is the stand-in's refund row or trade snapshot, rendered as sent.

**Real differences (intended, and why)**

- **No countdown strip and no auto-approval.** "Respond within 12h — auto-approved if you don't" is not built: the platform never approves for a silent seller, and a request stays open until answered, the item ships, or the delivery deadline passes. Saying otherwise would tell the seller something false.
- **"Contest — I've already shipped" is "Decline — I've already shipped".** The platform's decline is a plain decline with an optional note; it does not hold the refund for TrustOps. The reference's "contesting will hold the refund for TrustOps" line is replaced by "If you've already shipped, decline and the trade carries on."
- **Approving asks once.** Approve refunds the buyer and cannot be undone, so it opens a confirmation sheet ("Approve and refund") before anything is sent. The reference sends on the first tap.
- Added an optional "Note to the buyer" field (the platform takes one).
- Buttons come from `canRespond`; a buyer opening the address, a lapsed request and an answered one say so with no control.
