# F-027 plan: confirm delivery, inspect, complete and release (buyer; seller answers)

Feature: `docs/tickets/FEATURE_MAP.md` F-027 (absorbs T-065 and T-074, done, and T-118). Screens Z4, Z5, AB1, AB2,
DE1-DE4, BEI1, BEI2, Customer-4, MI4 (Living Master v2). Backend: T-065 (`inspection.routes.ts`), T-064
(`fulfilment.routes.ts`), T-074 (release runs from `trade.completed`, nothing for a screen to call).

## What is already there

- Workspace states `Delivery.tsx` (InTransit, DeliveryToConfirm) and `Inspection.tsx` draw the status banners, the
  inspection window and the waybill, with `SEAM(F-027)` where the actions go. `tradeActions` lists them as `later`.
- api-client: `useInspection`, `useDeliveryDeadline`, `useReportDelivered`. Missing: every write on the buyer side
  (confirm delivery, accept inspection, ask for more inspection time), the seller's answer to it, the delivery
  extension calls, and reading a private file (`GET /files/:id` returns a short-lived signed URL).
- Backend: every endpoint exists. **No backend change and no migration.**

## Plan

1. api-client (tests first): `confirmDelivery`, `acceptInspection`, inspection extension (request, accept, decline),
   delivery extension (request, accept, decline), `getFile`; widen `getInspection` to what Z4 draws (seller proof
   media, delivery signals, receipt, plate, the request's hours and note). Hooks that write the trade into the cache.
2. Customer-4 / Z4 / Z5 at `/trade/[id]/inspect` ("Inspect & Confirm"): window and countdown, seller's proof photos
   beside the delivery evidence, "Confirm & Release Payment" opening the Z5 sheet with the acknowledgement
   checkbox (the button stays disabled until ticked, body is `{acknowledged: true}`), BEI1 (buyer asks for more
   time, once) and BEI2 (seller accepts or declines) on the same screen by role.
3. Confirm delivery on the workspace: "Confirm you have it" on SHIPPED and "Confirm delivery" on UNCONFIRMED_DELIVERY
   (buyer); AB1 live logistics card (waybill, plate, dispatched) on the in-transit state.
4. Delivery extension: DE1 at `/trade/[id]/extend` (seller), DE2 (buyer accepts or declines, on the overview and
   Actions), DE3 overdue banner (buyer, deadline passed while funded or shipped).
5. Entry points: workspace overview, Actions tab rows live, `workspace-copy` seams removed.
6. Visual check into `docs/ui-review/T-118/`; builds, lint, typecheck, test, format; ticket status.

## Decisions (defaults, owner to confirm)

- **AB2 (pickup PIN) and the Park fee notice are not built.** Park (F-062) is dropped for MVP: self-arranged only,
  no hub custody, no pickup PIN. AB1 is the live-logistics card for a self-arranged shipment.
- **MI4 (multi-item inspection) is not built**: multi-item trades are F-080 (post-MVP). Z4/Z5 confirm the one item.
- **"Report an issue instead" (Z4) and DE3's "Request a refund" are not controls**: disputes are F-032 and refunds
  after payment F-030. They are said plainly, as the workspace already says it for those states. DE4 is the existing
  "Cancelled and refunded" outcome: the platform refunds on its own when the deadline passes with nothing shipped.
- **BEI1 as built asks the seller for more inspection time during inspection, once** (T-065), not "include with my
  proposal" as the reference draws it. Choices offered: +12 h, +24 h, and one more original window, which is the
  platform's cap; the platform's refusal is shown in its own words.
- No "Payment releases automatically after 48h" wording from a constant: the hours come from the trade's window.
- The seller's DE1 date is a date-and-time field; the cap (one original delivery window) is the platform's.
