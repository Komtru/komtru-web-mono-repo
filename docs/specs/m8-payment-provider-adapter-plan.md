# Payment Provider Adapter — Technical Plan (M8 Payment, Escrow & Ledger)

**Purpose of this document:** a self-contained build brief for the payment-provider layer of Module 8, to be handed to Claude Code as its instruction. It captures every architectural decision already made so the implementing engineer/agent doesn't have to re-derive or second-guess them — where a design choice was rejected, the reason is included so nobody "helpfully" reaches for the rejected option later.

---

## 1. Decisions this plan is built on (context, not up for reinterpretation)

- **Paystack is the first provider, not the only one, ever.** Everything below is built behind a provider-agnostic interface. Paystack is the one concrete implementation for now.
- **No Paystack Subaccounts, Transaction Splits, or Dedicated Virtual Accounts are used for holding or moving escrowed money.** Subaccounts/Splits settle automatically to a linked bank account on Paystack's own schedule the moment a charge is routed through them — there is no documented way to hold that money and release it later on command, which is a hard incompatibility with escrow. DVAs are a *funding-collection* mechanism (give a customer a bank account number to pay you), not a holding or payout mechanism, and route into the same auto-settling problem if paired with a subaccount. **Do not introduce either primitive into this module.**
- **Buyer charges land in the platform's own main Paystack balance.** No `subaccount` or `split_code` param on the charge. Escrow is 100% an internal ledger fact — Paystack has zero visibility into "this money is held for trade X."
- **Revised 2026-08-29 — buyer refunds go through Paystack's Refund API, not Transfer.** The earlier "everything is a ledger credit withdrawn via Transfer, no Refund API at all" decision is superseded for the buyer side. Sellers still get paid via **Transfer** (they're being paid for the first time — there's no original charge to reverse). Buyers getting money back — a full pre-dispute cancellation or a dispute-resolved partial amount — go through the **Refund API**, called against the original funding charge's reference, with `amount` set to whatever was decided (Refund supports partial amounts natively; it is not all-or-nothing). This is a deliberate return to a two-path model: Transfer for money leaving the platform for the first time (sellers), Refund for money reversing a charge that already happened (buyers).
- **Sellers still register a bank account (a Transfer Recipient); buyers generally do NOT need to for the standard refund path**, since Refund reverses to whatever the buyer originally paid with — no destination details required from them. Keep the `payout_accounts` table generic (it's keyed by `userId`, not role) in case a future edge case needs a buyer-side Transfer (see the open risk below), but nothing in the standard flow requires collecting one from a buyer.
- **Open risk, unconfirmed in Paystack's docs as of this writing: whether the Refund endpoint can be called more than once against the same original transaction.** The docs cap a single refund's `amount` at the original transaction total but say nothing about sequential/cumulative refunds against one charge (e.g., a 30% refund now, another 20% later after an appeal). Don't assume repeat refunds against one charge work until confirmed directly with Paystack support — and regardless of what Paystack allows, the ledger itself must enforce "cumulative refunded ≤ original charge amount" as its own safety net, not rely on Paystack to catch an over-refund.
- **Withdrawal timing is a platform feature, not a Paystack feature.** Paystack Transfers fire once, on request; there is no Paystack-side "schedule" concept. Any "auto-withdraw" or "withdraw on a schedule" preference a user sets lives in our own database and is enforced by our own backend deciding *when* to call Transfer — Paystack only ever sees the single resulting call.
- **Pinned-vs-pooled provider routing for Transfers is explicitly deferred**, not decided. With one provider it's a non-question. When a second provider is integrated, decide then whether a payout must be fulfilled by the same provider that collected the originating trade's funds ("pinned" — simpler to audit) or by whichever provider currently has settled liquidity ("pooled" — more resilient, more reconciliation work). This plan's schema needs to support either without a migration, which is why every money-moving row is provider-tagged from day one (§4).

## 2. Module layout

Follow the existing `backend-apis` module convention exactly (`bootstrap.ts`, `domain/`, `http/{controllers.ts,routes.ts,validations.ts}`, `index.ts`, `infrastructure/`, `services/`) — this is a new module, suggested name `ledger` (it owns the chart of accounts and journal, not just "payments"; the provider adapter is one thing living inside it, not the whole module):

```
src/modules/ledger/
  domain/
    providerAdapter.ts       # the canonical interface + shared types (below)
    journal.ts                # pure double-entry posting logic (existing M8 backlog scope, not this doc's focus)
  infrastructure/
    providers/
      paystack/
        client.ts             # hand-rolled HTTP calls, no SDK — see §5 for why
        webhook.ts             # signature verification + payload → NormalizedPaymentEvent
        client.test.ts
        webhook.test.ts
    providerRegistry.ts        # §6
  services/
    charge.service.ts          # initiate a buyer's funding charge
    payout.service.ts          # the "user clicked withdraw" flow
    payoutAccount.service.ts   # save/verify a bank account (buyer or seller)
    webhookIngest.service.ts   # idempotent webhook → ledger posting
  http/
    controllers.ts
    routes.ts                  # consumer-facing: POST /me/payout-accounts, POST /me/payouts, GET /me/ledger (or similar)
    webhookRoutes.ts            # POST /webhooks/paystack — see §8, no webhook mount pattern exists yet in this codebase
    validations.ts
  bootstrap.ts
  index.ts
```

Do not build a class hierarchy — mirror `src/modules/files/infrastructure/cloudinary.ts`'s existing style in this codebase: **plain exported functions, no SDK, credentials resolved from `@config/config` by a key**, not a stateful class instance. `cloudinary.ts`'s own doc comment explains why (a global-singleton SDK config object fights a multi-account design) — the same reasoning applies here in spirit even with one provider: keep credentials a parameter, not ambient state, so a second provider later is a second file, not a refactor.

## 3. The canonical adapter interface (`domain/providerAdapter.ts`)

```typescript
export type ProviderCode = 'PAYSTACK'; // union grows by one member per future provider

export interface InitializeChargeInput {
  amountMinor: number;      // kobo, never a float
  currency: string;         // 'NGN'
  reference: string;        // OUR reference, unique, idempotency key — e.g. `trade_fund_${tradeId}`
  customerEmail: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeChargeResult {
  providerReference: string;   // provider's own transaction reference/id
  checkoutUrl: string;         // where we redirect/embed the buyer to pay
}

export interface TransferRecipientInput {
  accountNumber: string;
  bankCode: string;
  accountName: string;         // from resolveAccountName — never trust user-typed name alone
}

export interface TransferRecipientResult {
  providerRecipientId: string;
}

export interface InitiateTransferInput {
  providerRecipientId: string;
  amountMinor: number;
  reference: string;           // OUR reference — e.g. `payout_${payoutRequestId}`
  reason?: string;
}

export interface InitiateTransferResult {
  providerTransferId: string;
  status: 'pending' | 'success' | 'failed';
}

export interface ResolvedAccount {
  accountName: string;
}

export interface Bank {
  name: string;
  code: string;
}

export interface InitiateRefundInput {
  chargeProviderReference: string;  // the ORIGINAL charge's provider reference — refunds reverse a specific charge, they don't target a person
  amountMinor: number;              // full or partial; must not exceed the original charge amount
  reference: string;                // OUR reference — e.g. `refund_${refundRequestId}` — for our own idempotency bookkeeping (Paystack's refund object has its own id, this is ours)
  reason?: string;
}

export interface InitiateRefundResult {
  providerRefundId: string;
  status: 'pending' | 'processing' | 'processed' | 'failed';
}

/** One member per normalized event this module acts on. Ledger-posting code (journal.ts, webhookIngest.service.ts) only ever sees this shape — never a provider's raw payload. */
export type NormalizedPaymentEvent =
  | { type: 'charge.succeeded'; reference: string; providerReference: string; amountMinor: number; paidAt: string }
  | { type: 'charge.failed'; reference: string; providerReference: string; reason: string }
  | { type: 'transfer.success'; reference: string; providerTransferId: string }
  | { type: 'transfer.failed'; reference: string; providerTransferId: string; reason: string }
  | { type: 'transfer.reversed'; reference: string; providerTransferId: string }
  | { type: 'refund.pending'; reference: string; providerRefundId: string }
  | { type: 'refund.processing'; reference: string; providerRefundId: string }
  | { type: 'refund.processed'; reference: string; providerRefundId: string; amountMinor: number }
  | { type: 'refund.failed'; reference: string; providerRefundId: string; reason: string };

export interface PaymentProviderAdapter {
  readonly code: ProviderCode;
  initializeCharge(input: InitializeChargeInput): Promise<InitializeChargeResult>;
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  parseWebhookEvent(rawBody: Buffer): NormalizedPaymentEvent | null; // null = an event type we don't act on, not an error
  resolveAccountName(accountNumber: string, bankCode: string): Promise<ResolvedAccount>;
  createTransferRecipient(input: TransferRecipientInput): Promise<TransferRecipientResult>;
  initiateTransfer(input: InitiateTransferInput): Promise<InitiateTransferResult>;
  initiateRefund(input: InitiateRefundInput): Promise<InitiateRefundResult>;
  listBanks(): Promise<Bank[]>;
}
```

Webhook events this module must handle now include `refund.pending`, `refund.processing`, `refund.processed`, and `refund.failed` (all documented Paystack events, confirmed directly against `docs/payments/webhooks/` — `refund.processed` means the processor completed it, `refund.failed` means Paystack has already credited the refund amount back to your own balance, which the ledger needs to reflect as "the platform's money again," not silently drop).

Every method that hits the network returns a `Promise` and throws `ApiError` (from `@modules/errors`, matching every other module) on a non-2xx or malformed response — no adapter method returns `undefined`/`null` for a call that actually failed; `null` is reserved for `parseWebhookEvent`'s "not an event we care about" case specifically.

## 4. Schema additions

Two new concerns, both additive to whatever M8's `journal`/ledger schema ends up being (this doc doesn't re-litigate the chart-of-accounts design already in the tracker backlog — it specifies what the provider layer needs *added* to it):

- **Every row that represents money crossing the Paystack boundary** (a funded charge, an outbound transfer, an issued refund) carries `provider: ProviderCode` and `providerReference: string`. This is the field that makes pinned-vs-pooled routing (§1, deferred) possible to decide later without a migration — don't skip it because there's only one provider today.
- **`payout_accounts`** table: `userId` (soft ref — sellers in the normal flow; kept generic rather than seller-only in case a buyer-side Transfer is ever needed as a fallback), `accountNumber`, `bankCode`, `accountName` (from `resolveAccountName`, not user-typed), `provider`, `providerRecipientId`, `verifiedAt`, `isDefault`. One person can have more than one on file; withdrawals target whichever they pick (or their default).
- **`payout_requests`** table: `userId`, `amountMinor`, `payoutAccountId`, `provider`, `providerTransferId`, `status` (`PENDING`/`SUCCESS`/`FAILED`/`REVERSED`), `requestedAt`, `resolvedAt`. This is the seller-payout row a webhook resolves — see §8.
- **`refund_requests`** table: `userId` (the buyer), `tradeId`, `amountMinor` (full or partial, decided by cancellation/dispute-resolution logic elsewhere in M8/M3), `chargeProviderReference` (the ORIGINAL charge being reversed — resolved from the trade's funding record, not typed by anyone), `provider`, `providerRefundId`, `status` (`PENDING`/`PROCESSING`/`PROCESSED`/`FAILED`), `requestedAt`, `resolvedAt`. The ledger equivalent of `payout_requests`, for the buyer side. Add a DB-level check (or a service-level guard backed by a `SUM(amountMinor) WHERE chargeProviderReference = ...` query) enforcing cumulative refunds against one charge never exceed that charge's original amount — this is the safety net mentioned in §1's open-risk note, and it must hold regardless of what Paystack itself permits.
- **`payout_preferences`** table — **added 2026-08-29**, this is a real feature now, not a hypothetical: one row per user, `userId` (PK), `mode` (enum `MANUAL | AUTO_IMMEDIATE | AUTO_DAILY | AUTO_WEEKLY | AUTO_MONTHLY`, default `MANUAL`), `defaultPayoutAccountId` (FK to `payout_accounts`, required at the service layer — not the DB layer, so the constraint's error message can be specific — whenever `mode != 'MANUAL'`; reject a mode change to any AUTO_* value if the user has no verified payout account), `updatedAt`. Exact semantics per mode, as specified by Emmanuel:
  - `MANUAL` — nothing happens automatically. The user visits their payouts page, picks an amount (up to their available balance) and a destination account, and clicks cash out — this is the existing `POST /me/payouts` flow, unchanged.
  - `AUTO_IMMEDIATE` — the instant a ledger event credits this user's available balance (a trade settles, a fee split posts), that exact amount is paid out right away, no waiting for a window. This is event-driven, not scheduled — see §7.
  - `AUTO_DAILY` / `AUTO_WEEKLY` / `AUTO_MONTHLY` — at the end of the relevant period, sweep the user's ENTIRE current available balance out in one Transfer. This IS scheduled — see §7's honest caveat about what that requires.
  - This table is conceptually a seller-side feature (it governs Transfer behavior, and buyers don't accumulate a swept-over-time balance the way sellers do under this model) but is kept generic/`userId`-keyed rather than role-gated, matching `payout_accounts`.

## 5. Paystack adapter (`infrastructure/providers/paystack/`)

Hand-rolled HTTP (no SDK), matching `cloudinary.ts`'s established rationale in this codebase. Endpoints used:

- `POST /transaction/initialize` — charge initiation. `reference` is always OUR generated idempotency key, never left for Paystack to generate.
- `GET /transaction/verify/:reference` — called as a defense-in-depth double-check when a webhook arrives (don't trust the webhook payload's amount/status blindly — verify against Paystack's own record before crediting the ledger).
- `POST /transferrecipient` — one call per bank account saved to `payout_accounts`.
- `POST /transfer` — `source: "balance"`, our `reference`, the recipient. **Requires OTP to be disabled on the integration first** — this is a one-time Dashboard/API setup action (`POST /transfer/disable_otp` + `/disable_otp_finalize`), not application code; call this out as a deployment/runbook step, not something the adapter itself needs a code path for.
- `GET /bank/resolve?account_number=...&bank_code=...` — backs `resolveAccountName`.
- `GET /bank` — backs `listBanks`.
- `POST /refund` — `transaction` (the original charge's reference/id, resolved from the trade's funding record — never accepted as raw input from a client), optional `amount` (omit for full, set for partial — dispute resolution outcomes almost always set this explicitly). Note from the docs: Paystack does not refund its own processing fee — the ledger's fee accounting needs to reflect that the platform absorbs that fee on every refunded trade, it isn't recovered.
- Webhook signature verification: HMAC-SHA512 of the raw request body using the Paystack secret key, compared against the `x-paystack-signature` header. **The webhook route must read the raw body before any JSON-parsing middleware touches it** — check how `express.json()` is applied per-route in `src/routes/v1/index.ts`'s `IRoute` registry (body parsing is applied per-mount there already) and make sure the webhook mount either skips it or captures the raw buffer first; a signature check against an already-parsed-and-reserialized body will intermittently fail.

Credentials: add a `PAYSTACK_SECRET_KEY` (and public key if needed client-side) to `src/config/config.ts`, following the existing pattern of a typed config section (see how `files` / Cloudinary credentials are resolved there) rather than reading `process.env` ad hoc inside the adapter file.

## 6. Provider registry (`infrastructure/providerRegistry.ts`)

```typescript
const registry: Partial<Record<ProviderCode, PaymentProviderAdapter>> = {
  PAYSTACK: paystackAdapter,
};

export const getAdapter = (code: ProviderCode): PaymentProviderAdapter => {
  const adapter = registry[code];
  if (!adapter) throw new ApiError(/* ... */, `No payment provider adapter registered for ${code}`);
  return adapter;
};

/** Which provider handles a brand-new charge. Today: always PAYSTACK. This is the seam a second
 *  provider's rollout logic (config flag, percentage split, health-based failover) plugs into later —
 *  don't build any of that now, just keep this function as the one place that decision would go. */
export const providerForNewCharge = (): ProviderCode => 'PAYSTACK';
```

Nothing else in the codebase should ever import `paystack/client.ts` directly — always go through `getAdapter()`. That's what makes adding provider #2 a new file plus one registry entry, not a grep-and-replace.

## 7. Services

- **`charge.service.ts`**: called when a buyer funds a trade (from M7's `/trades/:tradeCode/fund` handoff — M7 already stubs an `escrow.fund.requested` event for this module to consume, per the M7 build). Calls `getAdapter(providerForNewCharge()).initializeCharge(...)`, records the pending charge with its `provider`/`providerReference`, returns the checkout URL to the frontend. This charge record — specifically its `providerReference` — is what `refund.service.ts` later points a Refund at, so make sure it's queryable by `tradeId`.
- **`webhookIngest.service.ts`**: receives the parsed `NormalizedPaymentEvent`, re-verifies via `GET /transaction/verify` (or the transfer/refund equivalent) before trusting it, and is the ONLY place that posts ledger journal entries in response to a provider event. Must be idempotent on `providerReference`/`providerTransferId`/`providerRefundId` — Paystack webhooks are at-least-once delivery, a duplicate must be a no-op, not a double-credit (or a double-reversal, on the refund side).
- **`payout.service.ts`** (sellers) — **revised 2026-08-29 to support the preference modes above.** Split into a reusable core and three distinct triggers, so "how much and to which account" stays in one place regardless of what caused the payout:
  - `executePayout(userId, amountMinor, payoutAccountId, trigger: 'MANUAL' | 'AUTO_IMMEDIATE' | 'AUTO_SWEEP')` — the actual logic: verify the account is on file and verified, create a `payout_requests` row (tag it with `trigger` so support/ops can tell a self-service withdrawal from an automatic one), call `getAdapter(...).initiateTransfer(...)`, leave the ledger entry "pending" until the webhook resolves it. **This is the only function that ever calls `initiateTransfer` — everything below calls through it, nothing calls the adapter directly.**
  - The `POST /me/payouts` controller (`MANUAL`) — unchanged behavior, calls `executePayout` with the user-specified amount and account.
  - A ledger event listener (`AUTO_IMMEDIATE`) — subscribes to whatever event `journal.ts` publishes when it credits a user's payable balance (mirror the existing in-process event-emitter pattern this codebase already uses, e.g. `infrastructure/events.ts` in other modules). On receipt: look up `payout_preferences` for that user; if `mode === 'AUTO_IMMEDIATE'`, call `executePayout` immediately with exactly the amount just credited and the user's `defaultPayoutAccountId`. No batching — each credit event becomes its own payout, matching "as soon as cash becomes available, cash it out" literally.
  - A scheduled sweep job (`AUTO_SWEEP`, covering `AUTO_DAILY`/`AUTO_WEEKLY`/`AUTO_MONTHLY`) — **honest caveat: this needs an actual job scheduler, and this codebase does not have one yet** (the M8 backlog already flags this — "reconciliation job, scheduled once BullMQ lands"). Don't build a bespoke scheduler just for this; wait for or pair with whatever scheduler infrastructure lands first. When it exists: one job, run once daily at a fixed time. Every run: sweep every `AUTO_DAILY` user's current available balance. On the day that's the platform's designated weekly sweep day (propose Monday — arbitrary but simple, no per-user day-of-week field needed for v1), also sweep every `AUTO_WEEKLY` user. On the 1st of the month, also sweep every `AUTO_MONTHLY` user. Each sweep is one `executePayout` call per user for their full available balance at that moment — skip (don't error) a user with zero available balance or no verified `defaultPayoutAccountId`, and make skipped-for-missing-account visible somewhere an operator can see it (an M14 admin action log entry, or a notification to the user via M11, is enough — don't let it fail silently).
- **`payoutPreference.service.ts`** — get/set a user's `payout_preferences` row. Setting `mode` to anything other than `MANUAL` must reject with a clear error if the user has no verified `payout_accounts` row yet (there'd be nowhere to sweep to).
- **`refund.service.ts`** (buyers): triggered by a cancellation or a dispute-resolution outcome (from M3, once it exists) deciding a buyer is owed `amountMinor` back on `tradeId`. Resolves the trade's original funding charge to get `chargeProviderReference`, checks the cumulative-refund guard from §4, creates a `refund_requests` row, calls `getAdapter(...).initiateRefund(...)`, and leaves the ledger entry "pending" until a `refund.*` webhook resolves it. Unlike seller payouts, this does NOT require a `payout_accounts` row — the refund needs no destination on file. Whether this fires automatically the moment a resolution is decided, or only when the buyer visits their payments page and confirms, is a UX call the frontend/M3 side makes — this service should support being called either way (it takes an already-decided amount, it doesn't decide one).
- **`payoutAccount.service.ts`**: `resolveAccountName` before ever saving a bank account — never trust a user-typed account name, always confirm it against the provider.

## 8. HTTP surface

- `POST /webhooks/paystack` — **no webhook mount pattern exists anywhere in this codebase yet** (checked: nothing under `src/routes/v1/index.ts` or any existing module handles inbound provider webhooks). This is new ground — mount it outside the normal `IRoute` per-path `express.json()` wrapping (§5's raw-body requirement), verify signature via the adapter, parse, hand off to `webhookIngest.service.ts`, and always return 200 quickly (Paystack retries on non-2xx) even if the internal processing is queued/deferred.
- `POST /me/payout-accounts` — save + verify a bank account. Consumer-scoped, available to any ACTIVE user — needed by sellers for the standard flow, kept available to any user in case a buyer-side Transfer fallback is ever needed.
- `GET /me/payout-accounts` — list the caller's saved accounts.
- `POST /me/payouts` — a seller triggers a withdrawal (only meaningful/expected when `mode` is `MANUAL`, but not hard-blocked otherwise — a manual top-off withdrawal alongside an AUTO_* preference is harmless). Body: `{ amountMinor, payoutAccountId }`.
- `GET /me/payout-preferences` / `PUT /me/payout-preferences` — read/set `mode` and `defaultPayoutAccountId`. `PUT` rejects a non-`MANUAL` mode if no verified payout account exists yet.
- `GET /me/refunds` — a buyer's own refund history/status (mostly a read endpoint; whether there's also a `POST /me/refunds/:tradeId/claim` trigger, or refunds fire automatically once decided, is the UX call noted in §7 — build the read side regardless, decide the trigger shape once that's settled).
- `GET /me/ledger` or `GET /me/balance` — the read side of "what can I withdraw right now" (this may already be scoped elsewhere in M8's broader ledger design — check before duplicating).

Validate every endpoint with Joi (`@modules/validate`), errors via `ApiError`, register in `src/routes/v1/index.ts`'s `IRoute` array additively (the webhook route is the one exception to the standard per-path body-limit wrapping, per §5).

## 9. Explicit non-goals for this pass

Do not build, even as a stub: Subaccounts, Transaction Splits, Dedicated Virtual Accounts, or a second provider's adapter. All are architecturally wrong for this model (§1). (Two things this section previously excluded are now IN scope, both reversed 2026-08-29 — don't revert either without it being revisited explicitly again: the Refund API for buyer refunds — §1 — and automatic/scheduled payouts via `payout_preferences` — §4/§7.)

Do build the `AUTO_IMMEDIATE` path fully now (it needs no new infrastructure, just an event listener). Do NOT build the `AUTO_DAILY`/`AUTO_WEEKLY`/`AUTO_MONTHLY` sweep job's actual scheduling until a real job scheduler exists elsewhere in the codebase — build everything it depends on (`executePayout`, the `payout_preferences` schema and settings endpoints, the mode enum) so the sweep job itself is a thin addition once BullMQ (or whatever scheduler lands) exists, rather than blocking this whole module on infrastructure that isn't this module's job to build.

## 10. Suggested build order

1. `domain/providerAdapter.ts` types (no logic, just the interface — unblocks everything else being written in parallel).
2. Paystack adapter (`infrastructure/providers/paystack/`) + its own unit tests against fixture payloads (mirror `cloudinary.test.ts`'s honest-caveat pattern: no live Paystack account in a sandboxed build environment, so signature/shape construction is what's actually tested, and say so).
3. Schema (`payout_accounts`, `payout_requests`, `refund_requests`, `payout_preferences`, provider-tagging columns).
4. `providerRegistry.ts`.
5. Services (`charge`, `payoutAccount`, `payoutPreference`, `payout` — including the `executePayout` core and the `AUTO_IMMEDIATE` event listener, but not the sweep job's actual scheduling — `refund`, `webhookIngest`) in that order — each depends on the previous.
6. HTTP surface + route registration, webhook route last (it's the one with the raw-body wrinkle, easiest to get right once everything it calls already works).
7. Once a job scheduler exists elsewhere in the codebase: the `AUTO_SWEEP` job itself (§7) — everything it needs is already in place from steps 3–5, this step is genuinely small when it comes.
