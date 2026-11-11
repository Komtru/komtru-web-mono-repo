# AB1 — Active Trade — Live Logistics (T-118)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4690 — Active Trade — Live Logistics & Buyer Handover PIN — Mobile Web
- **Built:** http://localhost:3128/trade/0190b0a0-0000-7000-8000-000000000207
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 21,895 of 224,400 (9.76%)
- **Side by side:** `AB1.png` (reference · built · heat map) — **heat map:** `AB1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts, dates and photos are illustrative.

**Real differences (intended, and why)**

- **Self-arranged logistics only.** The reference's Park Hub card (hub address, "View my Pickup PIN") is not built: Park is dropped for MVP (F-062). The card shows what the platform records for a self-arranged shipment: when it was dispatched, the waybill and the vehicle plate. The driver's phone is the seller's and is never sent to the buyer.
- **Adds "Confirm you have it"** under the card and says inspection time starts when the buyer confirms.
- AB2 (the pickup PIN screen) is not built, for the same reason.
