# F-023 Terms, agreement and payment detail in the workspace (T-194) implementation plan

**Ticket:** T-194 (`docs/tickets/18-ui-master-v2.md`), feature F-023. **Screens (v2):** TW-01, TW-02, TW-03, TW-04, EX-01,
CWT-S01, CWT-S02, CWT-S03, CWT-S04, CWT-S05, CWT-S06, CWT-S07. **Branch:** `f-023-workspace-terms`. **Backend:** F-017 and
F-024, merged. No backend change, no migration, no api-client change (every read and write already has a hook).

**Goal:** the funding-side detail behind the tabbed workspace (F-022): what is agreed and what is left to pay (TW-01),
the fulfilment and policy pages (TW-02, TW-04), the accepted agreement and its history (CWT-S01, CWT-S02), the payment
sequence (CWT-S03 to CWT-S07, which are TW-03's states), and the expired trade (EX-01).

## How it sits on what exists

- **The payment screens already exist** as F-024's `FundTrade` (V1, V2, V3, AB3, AB4), one address `/trade/[id]/fund`
  whose step is the platform's payment display state. CWT-S03 to CWT-S07 and TW-03 are the v2 redraws of those same
  states, so they are built **in place**, not as a parallel set of routes: V1 gains the reference's trade reference, the
  protected-funds note and the awaiting-confirmation notice; a review step (CWT-S04) is added between choosing and
  paying; AB3, V3 and AB4 gain the reference's detail rows and actions. The reference's `/fund/review`, `/fund/processing`
  and `/fund/failed` URLs are not separate routes for the same reason: the step is the platform's state, not the
  address's. Existing F-024 tests are updated for the changed copy and the extra step.
- **TW-01** is CWT-01's overview for a trade waiting on payment (`AwaitingFunding`). It is extended with the reference's
  guard banner, agreed-terms rows, payment-status row and next-step paragraph; the body lives in the new `src/trade/terms/`
  directory and `states/Funding.tsx` delegates to it (one contiguous change).
- **EX-01** is the `EXPIRED` status after an agreement was accepted. `TradeScreen`'s closed-trade branch hands it to the new
  `TradeExpired`; an invitation that expired before anyone accepted keeps the existing closed screen.
- **New static routes** under `/trade/[id]/`: `fulfilment` (TW-02), `policies` (TW-04), `agreement` (CWT-S01),
  `agreement/history` (CWT-S02). `terms` stays the CWT-07 tab. Each is a static route so it takes precedence over
  `[tab]`.
- **Shared loader** `terms/TradeFrame.tsx`: loading, offline, error, not found and permission-denied for any screen
  that reads one trade, so each screen draws only its own content.

## What the platform cannot say (so the screens do not)

- **No funding deadline on the wire.** The trade view carries no expiry time and nothing in the trade service sets one
  for `PENDING_PAYMENT`, so TW-01's "Funding window 05:58:12 remaining" strip and every "six hours" line are not drawn.
  Owner question O1.
- **Only the current terms version is returned.** CWT-S02 lists the earlier versions as superseded without amounts or
  proposer, as `versionSteps` already does for CWT-07. Owner question O2.
- **Terms are locked once accepted** and no endpoint edits them, so TW-02's inputs are read-only rows.
- **No wallet.** CWT-S03's "Komtru Wallet" and TW-03's "Supported wallet" methods are not offered.
- **Withdrawal** is F-022's confirmation sheet on the Actions tab; TW-01's "Withdraw from trade" links to it.

## Steps (each committed when green)

1. [x] Plan (this file).
2. [x] `TradeFrame` and the agreement pages CWT-S01, CWT-S02 with routes and links from the Terms tab.
3. [x] TW-01: the awaiting-funding detail.
4. [x] TW-02 fulfilment terms and TW-04 policies with routes.
5. [x] EX-01 trade expired, wired into `TradeScreen`.
6. [x] Payment sequence in `FundTrade`: TW-03/CWT-S03 reference rows, CWT-S04 review step, CWT-S05, CWT-S06, CWT-S07.
7. [x] Axe checks, whole-package verification.
8. [x] Visual check against the v2 master (`docs/ui-review/T-194/`).

Tests: jsdom component tests against a faked api-client call (`test/support/workspace.tsx`), one file per screen group,
each ending with the axe check. Playwright e2e is waived: the repo has no e2e harness (T-192, T-193 precedent).
