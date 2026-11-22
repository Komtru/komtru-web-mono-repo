# Buy and Sell dashboards behind a switch — design

_2026-11-22 · owner decision · amends F-082 (2026-11-20)_

## Intent

F-082 removed the Buy/Sell switch: one account, one nav, and the side chosen per trade. The owner
is putting the switch back. A seller and a buyer need different things in front of them, so for now
each side gets its own dashboard and its own navigation. The account stays one account: F-082's
rules on who may buy and sell, and the selling limit, are unchanged.

## What stays from F-082

- One account. Anyone can buy, and anyone can sell up to the limit. A certified merchant can buy.
- The selling limit: ₦200,000 per trade and ₦2,000,000 per Lagos day without merchant status
  (`config/fees.yaml`, `casual_sell_limit`), checked when the seller commits.
- Create a trade still asks "Are you buying or selling?" (`SideChoice`). The side is a fact about the
  trade, not about the mode.
- Listings stay withdrawn (F-041, F-042).

## Owner decisions (2026-11-22)

1. **Everyone gets the switch, and can flip it freely.** It is a view preference (the `komtru_mode`
   cookie), not a permission. Someone who has not chosen lands on Buy. A certified merchant lands on
   Sell but can switch to Buy. The old merchant lock to Sell does not come back.
2. **Sell navigation: Shop, Orders, Payouts, Messages, Account.** Buy navigation stays Home, Trades,
   Messages, Discover, Account. Payouts moves from an Account row into the Sell nav.
3. **Trades are split by side.** Buy's Trades lists the trades where the person is the buyer. Sell's
   Orders lists the trades where they are the seller. Messages and Account are shared.
4. **The side step preselects from the mode.** Create a trade always shows "Are you buying or
   selling?", with Buying picked in Buy mode and Selling in Sell mode. One tap confirms or changes it.

## The two dashboards

- **Buy · Home** (Z1 and H-01 on phone, DX-03 on desktop, TX-02 on tablet): protected money as the
  buyer, the buyer's "needs your attention" (respond to a request, pay, inspect), active buying
  trades and recent activity.
- **Sell · Shop** (Seller-1 and H-02 on phone, DX-04 on desktop, TX-03 on tablet): the KPI strip
  (available to withdraw, in escrow, to ship, returns inbound), the seller's "needs your attention"
  (respond to a request, ship, check a return), active orders and recent activity. An account
  without merchant status also sees what is left of today's selling limit, with a link to merchant
  status. The reference's Listings and "Ask Buyer" entries are left out.
- **Orders** brings back AC8 on phone and DX-18 on desktop from before F-082 (`ActiveOrders`,
  `OrdersWide`, removed in `92983a9e`), filtered to the seller's side.

## Left to the builder

- Whether "needs your attention" and the KPI strip can come from the existing trade list, filtered
  by side, or need a summary endpoint. Never compute a money figure in the browser that the
  backend does not report.
- Where a deep link from the other side lands. For example, a buyer's notification opened in Sell
  mode should open the trade, not change the mode silently.
- Updating `nav.test.ts`, `shell.test.tsx` and `side-choice.test.tsx`, and bringing back the removed
  orders tests.
