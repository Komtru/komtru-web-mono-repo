# F-015 — Home, trade search and find-a-trade-by-code (T-113) implementation plan

**Ticket:** T-113 (`docs/tickets/13-web-app-ui.md`), feature F-015. **Screens (v2):** Z1, H-01, H-02 (not built, see below),
H-03, Customer-1, AC1, SE1, SE2, F1, F2. K1 and K2 are deferred with the catalogue and not built.
**Branch:** `f-015-home-trade-search`. **Backend:** none new. `GET /trades` and `GET /trades/by-code/:code` ship in
`apps/backend-api/src/modules/trades`. No migration, no backend change, no api-client change.

**Rescope (owner, 2026-11-15):** home lists the user's own trades, past and pending their acceptance. Search covers trades
only. There is no listing index (T-057 is deferred).

## What the platform gives us, and what it does not

- `GET /trades?state=ALL|OPEN|CLOSED&limit&cursor`: `tradeListItemSchema` rows with `status`, `attention` (server-decided,
  `null` = nothing asked of you), `counterparty` (handle, display name, avatar), `item.title`, `item.categoryName`,
  `itemAmountMinor`, `tradeCode`, `updatedAt`. Newest-relevant first. **No text query parameter.**
- `GET /trades/by-code/:code`: `{ access: 'PARTY' | 'INVITEE', trade: { id, tradeCode, status, statusRevision, yourRole,
categoryCode, categoryName, standardVersion, standardVersionId }, counterparty }`. No item title, no amount. 404 for a
  code the viewer is neither a party to nor the invitee. Ten tries a minute per person.
- Not on the platform, so not drawn: a protected-balance total and an all-time total (Z1/H-01/H-03 hero), the
  Buy/Sell switch on Home (Sell is the merchant listing surface, deferred), a greeting with the viewer's name (the shell
  viewer carries no name), recent searches (nothing is stored), the seller's reviews and trust stats on F2 (F-016),
  "Browse a seller's Trust Passport" on F1 (F-016).

## Structure

| Path                        | Holds                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/home/classify.ts`      | pure: split trades into needs-attention / active / past; the query match; the Trade Code test                                     |
| `src/home/useAllTrades.ts`  | drains every page of `useTradeList('ALL')` (search and home need the whole list), subscribes the shown trades with `useTradeLive` |
| `src/home/TradeLine.tsx`    | one trade as a row (wraps ui-kit `TradeRow`, own copy of the mapping so the trade module is not edited)                           |
| `src/home/HomeScreen.tsx`   | Z1 / H-01 / Customer-1 populated, AC1 and H-03 empty, loading, error                                                              |
| `src/home/SearchTrades.tsx` | SE1 (search, results) and SE2 (no results)                                                                                        |
| `src/home/FindTrade.tsx`    | F1 (enter a code) and F2 (found: party or invitee), not-found, invalid code, rate limit                                           |
| `app/(app)/home/page.tsx`   | route, shell tab `home`                                                                                                           |
| `app/(app)/search/page.tsx` | route `/search?q=`, shell tab `discover`                                                                                          |
| `app/(app)/find/page.tsx`   | route `/find?code=`, shell tab `discover`                                                                                         |

Shared files touched (smallest possible, called out in the report):

- `src/shell/nav.ts`: Discover's href `/browse` becomes `/search` (the browse catalogue is deferred and the tab would
  otherwise lead nowhere); `searchDestination` sends a non-code query to `/search?q=` instead of `/browse?q=`.
- `src/shell/ShellTools.tsx`: the search placeholder says "Search your trades" instead of "Search trades or sellers".
- `test/nav.test.ts`, `test/shell.test.tsx`: the pinned values follow.

Not touched: `src/trade/**`, `app/(app)/trade/**`, `app/(app)/trades/**` (its `MyTrades` renders the trade-owned
Q1 list and its empty state, which lacks the "Enter a Trade Code" button; flagged for the owner, not changed here),
`listings`, `shop`, `browse`.

## Behaviour per screen

- **Home (Z1, H-01, Customer-1).** Summary line "n need your attention · m active". Sections in order: _Needs your
  attention_ (rows with `attention !== null`), _Active trades_ (open, no attention), _Past trades_ (closed: declined,
  cancelled, expired, rejected, or resolved). A "View all trades" link to `/trades`. Quick actions: Find a trade
  (`/find`), Start a trade (`/trade/new`), Search trades (`/search`). Every trade row links to `/trade/<id>`, as the
  trade module's own rows do.
- **Home empty (AC1, H-03).** `EmptyState` "No protected Trades yet", body from AC1, with _Start a Trade_ and _Enter a
  Trade Code_ as siblings beneath the panel (the AC1 review note says the reference puts them outside the panel), plus
  the H-03 info banner.
- **Home loading / error.** A status region "Loading your trades"; `LoadFailed` with retry.
- **Search (SE1).** Input with a label; the list is drained once, then filtered client-side by item title, category,
  counterparty name or handle, and Trade Code. A query that is a Trade Code not in the user's trades offers "Find trade
  KMT-…" to `/find?code=`. Empty query: a hint, no results.
- **No results (SE2).** "No trades match "drone"", body explaining that search covers the user's own trades, action
  _Propose a Trade_ to `/trade/new`.
- **Find a trade (F1).** Mono input, validated with `tradeCodeSchema`; an invalid code shows the inline error without a
  call. Submitting calls `GET /trades/by-code/:code` once (no retry, no refocus refetch). A banner warns that a link is not
  a verified Trade and the code is.
- **Found, party (F2).** "Verified Trade — found on Komtru" chip, the code on a `CodeCard`, counterparty `PartyStrip`,
  status line from `describeTrade`, _Open trade_ to `/trade/<id>`.
- **Found, invitee (F2 variant).** "You're invited" with the inviter's strip and _Take your place_ to `/trades/<code>`,
  the trade module's claim screen, which owns the claim and the address rule. F-015 does not duplicate the claim.
- **Not found.** 404: "No trade found for you" with the same wording as the trade module's by-code screen. Rate limit:
  the platform's rate-limit sentence. Other failures: `LoadFailed`, with retry unless rate limited.

## Test-first order (each step a green commit)

1. `classify.ts` pure tests (attention, active, past; query match; trade-code test).
2. `useAllTrades` drains pages and stops; live subscription uses shown ids.
3. `HomeScreen` states: loading, error, empty (AC1 copy and both buttons), populated (sections, counts, links).
4. `SearchTrades` states: hint, results, code offer, SE2 no results.
5. `FindTrade` states: invalid code, party, invitee, not found, rate limit, other error; one call only.
6. Shell changes (`nav.ts`, `ShellTools.tsx`) and their pinned tests.
7. Routes (`home`, `search`, `find`) and a route-level smoke test.
8. Visual check against the v2 reference, evidence in `docs/ui-review/T-113/`.

## Verification

`pnpm --filter "./packages/**" build` (done), then `pnpm -w exec turbo run lint typecheck test`. No backend test is
expected to run; if one is, `KOMTRU_TEST_DB_PREFIX=komtru_f015` is exported first.
