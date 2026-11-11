# F-026 plan: accept, prove, prepare and ship an item (seller)

Feature: `docs/tickets/FEATURE_MAP.md` F-026 (absorbs T-064, done, and T-123). Screens Seller-2, Seller-3, W1-W3, BR1,
SD1, X1, X2, AC8, MI3 (Living Master v2). Backend: T-064, `docs/tickets/07-trades.md`.

## What is already there

- **Seller-2, W1, W2, W3, BR1, SD1** were built by F-017 inside `TradeScreen` / `ProposeChange`: the seller reads the
  buyer's request, attaches mandatory proof (`ProofUpload`, gate on Accept), proposes changes, or declines behind a
  confirm sheet. This feature does not rebuild them; the visual check re-confirms them.
- **Backend** `GET /trades/:id/ship-options`, `POST /trades/:id/ship/self-arranged` (waybill, receipt photo, driver
  phone, plate), the dispatch guard (409 until `FUNDED`), `GET /trades` with `attention: SHIP`. Nothing is missing that
  blocks a seller from shipping, so **no backend change and no migration**.

## What is missing (this feature)

1. **api-client**: no endpoint or hook for the ship step. `getShipOptions`, `shipSelfArranged`, `useShipOptions`,
   `useShipSelfArranged` (writes the trade the platform answers with into the trade cache).
2. **Ship Order (Seller-3 + X2)** at `/trade/[id]/ship`: header "Ship KMT-...", the funds-protected banner and the
   deadline, the item and where it goes, then the four evidence fields. Self-arranged only (see decisions).
3. **Dispatch locked (X1)**: the same address before the trade is funded shows the locked state (agreement,
   escrow not yet funded, shipped locked) with a disabled "Dispatch locked" control, decided from the trade's status;
   the platform's 409 is the backstop (shown as the same locked screen).
4. **Entry points**: `FundsProtected` gets "Prepare and dispatch" for the seller (the SEAM(F-026)); the Actions row `ship`
   becomes live with that href.
5. **Active Orders (AC8)** at `/orders`: the seller's trades grouped by custody stage (Ready to ship, In transit,
   Awaiting buyer inspection) from `GET /trades`, kept current by the trade rooms.

## Decisions (defaults, owner to confirm)

- **Park (X1/X2 Park branch, handover OTP) and courier companies are left out.** F-062 and F-066 are dropped for MVP;
  the server returns Park unavailable and no company, so the screen offers only "Arrange my own shipping" and shows no
  Park option, no handover PIN. If the platform ever lists an enabled company the screen still offers only the
  self-arranged form, because there is no company endpoint yet (T-087 seam).
- **MI3 (multi-item ship) is not built**: multi-item trades are F-080 (post-MVP). One waybill covers one item today.
- **Seller-3's "courier / tracking number / optional photo" is X2's four fields**: the backend requires waybill number,
  receipt photo, driver phone and plate, so the form is the stricter X2.
- No "Respond within 4 hours" countdown on Seller-2: no API field carries it.

## Steps

1. Plan (this file).
2. api-client endpoints and hooks, tests first.
3. `ShipOrder` (X1, X2/Seller-3), tests first; route.
4. Workspace entry points and Actions row; update the tests that pinned "not in the app yet".
5. Active Orders (AC8), tests first.
6. Visual check into `docs/ui-review/T-123/`.
7. Package builds, lint, typecheck, test, format.
