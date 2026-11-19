# F-069 / F-073 — Fulfil, dispatch, complete and payouts at desktop and tablet

One responsive pass over four screens that already work on a phone (F-026 ship, F-037 payouts, F-022 workspace). The
other half of F-069/F-073 (Deliver & inspect) is built in parallel by another agent and is out of scope here, as is
DX-20 (Create listing, F-041, deferred).

| Desktop | Tablet | Screen                | Phone screen it arranges                     | Component                                             |
| ------- | ------ | --------------------- | -------------------------------------------- | ----------------------------------------------------- |
| DX-18   | TX-11  | Orders                | Active Orders (AC8)                          | `src/trade/ActiveOrders.tsx` plus `src/trade/orders/` |
| DX-19   | TX-12  | Dispatch workspace    | Ship order (Seller-3, X1, X2)                | `src/trade/shipping/ShipOrder.tsx`                    |
| DX-31   | —      | Trade complete        | Customer-5 `TradeComplete` (workspace state) | new `src/trade/complete/TradeCompleted.tsx`           |
| DX-32   | TX-19  | Payouts & performance | Seller-6 Payouts                             | `src/payouts/Payouts.tsx`                             |

## The responsive pattern

Follow `ProposeWorkspace` (md = 768 tablet, lg = 1024 desktop). Where one tree can be rearranged by CSS it is; where a
screen is a different structure at a width (a table on desktop, a list and detail pane on tablet, rows on a phone) a
small `useViewportTier()` hook (`src/trade/shipping/viewport.ts`, `useSyncExternalStore` over `matchMedia`, server
snapshot `base`) picks one tree, so nothing is rendered twice. Every screen here fetches on the client, so the first
paint is a skeleton and the tier is known before any data shows: there is no mobile-then-desktop flash.

## Screen by screen

**Orders (DX-18, TX-11).** Exists: the grouped, three-stage list of the seller's open trades. Phone keeps it as is.
Tablet: a chip row (All, Needs action, Ready to ship, In transit, Inspecting, each with a count), the list on the left
and a detail pane for the chosen order on the right (item, buyer, amount, payment, next step, primary action).
Desktop: the same chips over a table (Trade, Buyer, Item, Amount, Status, Next step, action). Data is `useTradeList`
read to the last page, as today.
Not built, with reason: the bulk bar (Generate waybills, Mark as shipped, Message buyers) has no endpoint behind it, and
messaging is deferred; Due has no per-trade source in the list (the row's server-decided attention is shown as Next step
instead); Returns has no data; Create listing is F-041.

**Dispatch workspace (DX-19, TX-12).** Exists: `ShipOrder` (waybill, receipt photo, driver, plate, deadline, locked and
shipped states). Wide widths arrange the same form in two columns: the readiness banner, a handover checklist (the
seller's own reminder; the phone has it on its own step) and the proof fields on the left; the order summary, the
delivery deadline and "How it travels" on the right, with actions under both. Tablet narrows the right column. Park and
couriers are out of the MVP, so "How will it travel?" says the one thing that is true: the seller arranges delivery.
`/trade/[id]/dispatch` (the phone's checklist step, owned by Deliver & inspect) renders this workspace from `md` up, so
Orders' Dispatch action lands on it, as in the reference URL.

**Trade complete (DX-31).** The phone's completed state is a workspace body the other agent owns. This is a standalone
route, `/trade/[id]/completed` (`/complete` is taken by the seller-completes-a-request flow, F-018): the result banner
(the amounts come from the trade's fee snapshot, never summed), the summary, the four-step record (agreement version,
funds protected, delivered and inspected, released) and "Added to your Trust Profile" (completed trades and the
category's, counted from the closed list). The review form is deferred (F-038): the block says reviews are not open yet,
and has no inputs. A trade that is not complete shows its own refusal and a link back. One column at tablet, two at
desktop. Nothing links here yet from the workspace (`Ending.tsx` is the other agent's): Orders' completed filter does.

**Payouts & performance (DX-32, TX-19).** Exists: balance, schedule sheet, account, history. Wide: a heading with the
reference's subtitle, a row of tiles (only figures the platform can answer: orders to ship, in transit, open disputes,
payouts paid), the balance card and payout account in a side column, and the history as a table (Date, To, Amount,
Status). Fulfilment rate, average dispatch time and returns have no source and are not drawn.

## Tests (Vitest and Testing Library, each suite ends in axe)

Stubbed `matchMedia` sets the width. `test/orders-wide.test.tsx`, `test/ship-wide.test.tsx`,
`test/trade-completed.test.tsx`, `test/payouts-wide.test.tsx`, `test/viewport.test.tsx`. The existing phone suites
(`active-orders`, `ship-order`, `payouts`) must stay green untouched.

## Visual check

Stand-in fixtures for the payouts reads and a completed trade, walks for each screen, desktop (1040) and tablet (560)
captures, notes in `docs/ui-review/T-209/` and `docs/ui-review/T-213/`.
