# One account, sides per trade, and the seller limit — design

_2026-11-20 · short design (small change) · approved approach: enforce when the seller commits_

## Intent

Komtru has no buyers and sellers, only accounts. Any account buys and sells, and which side it is on
is a fact about one trade, not about the account or a mode it is in. Merchant status is not a
different kind of account: it lifts the selling limit.

## Goals

- Remove the Buy/Sell switch from the app header. There is one nav: Home, Trades, Messages,
  Discover, Account.
- Start Trade asks "Are you buying or selling?" and opens the existing `BuyerStart` or `SellerStart`
  flow from the answer. `?with=` still pre-fills the other party.
- Remove the seller-only destinations: Shop, Orders, Listings (pages, nav entries, the mode cookie,
  `modeFor`/`landingFor`, `ModeSwitch` where nothing else uses it).
- A certified merchant can buy. Drop the sell-only rule (`canActAsBuyer` false on an ACTIVE
  `MERCHANT` capability) in the backend and the shell.
- Enforce a selling limit on accounts without an ACTIVE `MERCHANT` capability:
  - **₦200,000** per trade (item value the seller agrees to);
  - **₦2,000,000** total selling value agreed per day.
  - Merchants: no selling limit.
  - Buying is never limited.

## Non-goals

- No change to merchant certification itself (F-040) beyond what it unlocks.
- No buying limit, no limits tied to verification level.
- No listings, storefront or catalogue (F-041–F-043 are withdrawn, not deferred).

## Limit rules (owner-set 2026-11-20; the parts marked _call_ are proposals the owner accepted)

- **When it is checked (approach 1):** at every point the seller commits to terms — creating a trade
  as seller, accepting a buyer's request, and any terms change that raises the item value. Refused
  with a clear error; nothing gets funded and then blocked.
- **What counts toward the day** _(call)_: trades where the account is the seller and agreed terms
  that day. A trade that is cancelled, declined or expires stops counting.
- **The day** _(call)_: calendar day in Africa/Lagos, reset at midnight.
- **Where the numbers live** _(call)_: in `config/` beside the fees, versioned the same way
  (`fees.yaml` or a sibling `limits.yaml`), never in code or bundles.
- **The UI warns early:** the Start Trade amount step and the accept screen say when the amount is
  over the per-trade limit or today's remaining allowance, and point to merchant status.

## Approaches considered

1. **Check when the seller commits** — picked. Covers seller-created, buyer-requested and edited
   trades; the buyer never pays into a trade that is then refused.
2. Check at funding — one check point, but the buyer learns at payment, the worst moment in escrow.
3. Check at creation only — simplest, but misses buyer-started trades and later price raises.

## Left to the builder

- Exact error codes and copy, and whether the daily sum reads from the trade table or the
  state-change log.
- Concurrency: two acceptances at once must not both slip under the daily total (lock or serialise
  per seller).
- FEATURE_MAP and ticket housekeeping: rewrite F-012 (no mode switch), withdraw F-041–F-043, add the
  limit as its own feature or under F-040.
