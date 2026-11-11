# DE3 — Delivery Overdue (T-118)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4824 — Delivery Extension — Mobile Web
- **Built:** http://localhost:3128/trade/0190b0a0-0000-7000-8000-000000000206
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,583 of 224,400 (10.06%)
- **Side by side:** `DE3.png` (reference · built · heat map) — **heat map:** `DE3.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts, dates and photos are illustrative.

**Real differences (intended, and why)**

- **No "Request a refund" button.** Reference DE3 offers a refund or keep waiting. The platform decides this itself at the deadline (nothing shipped and no extension means an automatic refund, DE4; a shipped trade just keeps waiting), and a buyer refund request is F-030. The screen says the date passed, that the money stays protected, and that nothing shipped means a refund.
- It is a banner on the overview, not a full screen.
- DE4 (refund issued) is the existing "Cancelled and refunded" outcome the overview already draws for `CANCELLED_REFUNDED`.
