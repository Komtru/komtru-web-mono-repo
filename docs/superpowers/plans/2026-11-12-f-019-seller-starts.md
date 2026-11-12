# F-019 Create a trade: seller starts, buyer completes (T-193) implementation plan

**Ticket:** T-193 (`docs/tickets/18-ui-master-v2.md`), feature F-019. **Screens (v2):** CT-S1, CT-S2, CT-S2F, CT-S3, CT-S4,
CT-S5 (seller starts), CT-S6, CT-S7 (buyer completes). **Branch:** `f-019-seller-starts`. **Backend:** F-017, merged.
No backend change, no api-client change, no migration.

**Goal:** a seller names the buyer and describes the item completely (they are the authoritative source), sets the
delivery partner, charge and promise, and sends it. The buyer then chooses how to receive it (CT-S6), reviews the
agreement and accepts (CT-S7).

## How it sits on the platform (and on F-018)

- A seller-started trade is an ordinary seller proposal: `POST /trades` with `role: SELLER`, the category's whole item
  specification, the ships-from address and the proof media, then `POST /trades/:id/send`. Nothing is waiting on the
  seller, so no `Seller to confirm` value is ever written.
- Delivery commitments ride in the item specification under the reserved keys F-018 introduced (`deliveryMode`,
  `deliveryPartner`, `deliveryChargeMinor`, `deliveryPromise`), so they are on the version the buyer accepts.
  `requestedItem` carries the seller's name for the item.
- The buyer's choice (CT-S6) is the delivery address, which the platform already takes on `POST /trades/:id/accept`.
  Park is deferred for MVP (`PARK_DELIVERY_ENABLED`); the Park card is drawn "Coming soon" and Courier is the only live
  mode. Recording a Park choice would need a counter, which is not built.
- Reuse: `StageHeader`, `Agreement`, `Terms`, `Sent` and `readRequest` from `src/trade/create/`, `AddressPicker`,
  `ProofUpload`, `ConfirmSheet`. `Agreement` gains a "party" label (Buyer or Seller) and an optional "you receive" row;
  `Sent` takes the viewer's role.
- A seller-started proposal with no delivery commitments (made before this flow) keeps the existing answer screen.

## Routes

| Route                 | Screen                | Reads / writes                                                        |
| --------------------- | --------------------- | --------------------------------------------------------------------- |
| `/trade/new` (sell)   | CT-S1 to CT-S4, CT-S5 | standards, lookup, preview, addresses, files, `POST /trades`, `/send` |
| `/trade/[id]` (buyer) | CT-S6, CT-S7          | the trade, preview, addresses, `POST /trades/:id/accept`, `/decline`  |

## Steps (each committed when green)

1. [x] Plan (this file).
2. [x] Pure logic in `create/request.ts`: `sellerSpec`, `isSellerOffer`. Tests first.
3. [x] Seller start CT-S1 to CT-S5 and the Sell-mode route.
4. [x] Buyer completes CT-S6, CT-S7, wired into the trade screen.
5. [x] Visual check against the v2 master (`docs/ui-review/T-193/`).
6. [x] Verification: packages build, lint, typecheck, test for web-app-ui and api-client, `format:check`.

## Owner questions (defaults taken)

- **O1** No listings exist, so CT-S1's listing picker is replaced by the item's name and price typed by the seller.
- **O2** The buyer's address on file is not shown on CT-S1 (no route exposes it); the buyer gives it at CT-S6.
- **O3** As F-018: the delivery charge is a separate line and not part of the funded total.
- **O4** As F-018: the seller types the delivery partner and charge; no approved-partner catalogue exists.
- **O5** Park for the buyer at CT-S6 is "Coming soon" until a Park catalogue and a way to record the choice exist.
