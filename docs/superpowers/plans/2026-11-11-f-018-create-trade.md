# F-018 Create a trade: buyer starts, seller completes (T-192) implementation plan

**Ticket:** T-192 (`docs/tickets/18-ui-master-v2.md`), feature F-018. **Screens (v2):** CT-B1, CT-B2, CT-B2P, CT-B3, CT-B4,
CT-B5 (buyer starts), CT-B6, CT-B7, CT-B8, CT-B8P, CT-B9 (seller completes), CT-B10 (buyer reviews and accepts).
**Branch:** `f-018-create-trade-buyer`. **Backend:** F-017, merged. No backend change, no migration.

**Goal:** a buyer states what they want and where it should go (stages 1 and 2), sends it, and the seller adds what only
they can (item details, delivery) and sends it back; the buyer then reviews the finished agreement and accepts.

## What the platform can and cannot hold (and what this builds on)

The platform's create route validates the whole item specification at creation and has no field for a delivery partner,
a delivery charge, a delivery promise or a Park. The v2 flow has the buyer send a request with the item specification
still open. Without touching the backend:

- **Waiting fields.** The request is created as an ordinary buyer proposal. Each field the category requires that only
  the seller can know is stored as the literal `Seller to confirm` (`SELLER_TO_CONFIRM`); the buyer's own words for the
  item are stored as `requestedItem`. The seller completes them with the existing **counter** call (the seller's turn),
  replacing every waiting value. The screens read "Waiting" for any field holding the sentinel, so nothing the seller has
  not said is ever shown as fact, and `itemTitle`/`itemSub` ignore it.
- **Delivery commitments** (partner, charge, promise, Park, collection phone) have no column. They ride in the item
  specification under reserved keys (`deliveryMode`, `deliveryPartner`, `deliveryChargeMinor`, `deliveryPromise`,
  `parkId`, `contactPhone`) so they are on the terms version both parties accepted. They are **not** in the fee snapshot:
  the total due on funding is the platform's `buyerTotalMinor` and nothing is added on the client, so the delivery
  charge is shown as its own line, labelled as not part of the total. Owner question O2.
- **Category** is detected from the item words against the live Trade Standards (never asked when detected); when nothing
  matches, a category picker appears, because the platform requires one. Owner question O1.
- **Park** is deferred for MVP (`docs/MVP.md`, no hub catalogue route). CT-B2P and CT-B8P are built and tested, behind
  `PARK_DELIVERY_ENABLED = false`; Courier is the only live mode and the Park option reads "Coming soon". Default per the
  Q3 pattern (screen behind a disabled flag).
- **Approved delivery partners** have no catalogue endpoint before funding, so CT-B8 takes the partner name and charge as
  typed by the seller rather than a list of invented partners and prices. Owner question O3.
- **Delivery promise** ranges (1-3, 5-7, 7-10, 10-15 days) are filtered by the standard's `deliveryDeadlineDays`.
- **Money:** every figure is the platform's kobo string via `naira`; the client only parses what the seller types.

## Routes

| Route                  | Screen                      | Reads / writes                                                 |
| ---------------------- | --------------------------- | -------------------------------------------------------------- |
| `/trade/new` (buyer)   | CT-B1 to CT-B4, CT-B5       | standards, lookup, preview, addresses, `POST /trades`, `/send` |
| `/trade/[id]`          | CT-B5 / CT-B6 / CT-B10      | the trade; chosen by status, whose turn and role               |
| `/trade/[id]/complete` | CT-B7, CT-B8, CT-B8P, CT-B9 | pinned standard, addresses, `POST /trades/:id/counter`         |

Seller-started trades (F-019) keep the existing I3 screen; only the Buy mode of `/trade/new` changes.

## Steps (each committed when green)

1. [done] Plan (this file).
2. [done] Pure request logic (`create/request.ts`): detection, waiting spec, promises, parsing. Tests first.
3. [done] Buyer start CT-B1 to CT-B5 and the Buy-mode route.
4. [done] Seller request CT-B6 and completion CT-B7 to CT-B9, with the `/trade/[id]/complete` route.
5. [done] Buyer review and accept CT-B10, wired into the trade screen.
6. [done] Visual check against the v2 master (`docs/ui-review/T-192/`).
7. [ ] Verification: packages build, lint, typecheck, test for web-app-ui and api-client, `format:check`.

## Owner questions

- **O1** Category detection from the item words is a keyword match here; should the platform detect it from the item?
- **O2** Should the delivery charge be part of the funded total and the fee snapshot? Today the platform has no field.
- **O3** Which delivery partners are approved, with what cost? No catalogue route exists before funding.
- **O4** Should the platform accept a buyer proposal with the item specification open (instead of the sentinel)?
