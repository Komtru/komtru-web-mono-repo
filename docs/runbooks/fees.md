# Changing a fee

Every fee and every platform cut Komtru charges lives in one file, `config/fees.yaml` (design §6.5).
No fee amount or rate appears anywhere else: not in code, not in database seeds, not in a frontend
bundle. This runbook is how you change one safely.

## The change

1. **Edit the value in `config/fees.yaml`.** Only there. If you find yourself editing a second file,
   stop — something has gone round the fee module and should be fixed instead.
2. **Bump `version`.** It is `YYYY-MM-DD.N`: today's date, then a counter for a second change on the
   same day. `2026-10-05.1` → `2026-10-05.2`.
3. **Open a PR.** Git history is the audit trail; there is no admin screen for fees and no database
   row to change.
4. **Merge and deploy.** The next backend boot reads the new file.

## What CI will say if you forget

`tools/fee-version-check/cli.mjs` compares your branch's file against `main` and fails naming the
key you changed:

```
config/fees.yaml: buyer_protection_fee.rate_bps changed but version was not bumped (still 2026-10-05.1).
```

It runs in two workflows: `backend-api` and `repo`. The second matters — `backend-api` is
path-filtered to the app and its packages, and `config/` is outside that filter, so a commit that
touches only the fee file is checked by the unfiltered `repo` workflow alone.

A `version` that goes backwards fails too, with or without a value change.

To run it yourself before pushing:

```bash
node tools/fee-version-check/cli.mjs origin/main
```

## What a fee change does and does not affect

It affects **new** trades and new Park parcels only.

When a trade's terms are accepted, `snapshotFees` freezes the schedule version, the computed
amounts and the terms they were derived under onto the trade. Every ledger posting for that trade
reads the snapshot, never the live file, so a buyer who was quoted a total before funding pays
exactly that total however many times the file changes afterwards. The snapshot also carries
`buyerProtectionRefundableOnFullRefund`, so a refund months later follows the rule that was in force
when the trade was accepted.

The same goes for a Park parcel: it snapshots the cash handling range it told the buyer to expect.

So a fee change is never retroactive, and you cannot fix a mispriced open trade by editing this
file. That trade has to be handled through a refund or an adjustment.

## Checking what production is serving

```bash
curl https://api.komtru.com/v1/config/fees
```

The response is the live schedule, with amounts as whole-kobo strings. `version` is the field to
compare against the file you merged.

## When the backend refuses to start

The schedule is parsed and validated at import, before the API or the worker listens, so an invalid
file is a boot failure rather than a surprise at the first trade. The error names the key and never
the value you typed:

```
FeeScheduleError: config/fees.yaml is invalid: buyer_protection_fee.rate_bps: Invalid input: expected int
```

The rules the schema enforces:

- `version` looks like `YYYY-MM-DD.N`, and `currency` is `NGN`.
- A rate is a whole number of basis points from 0 to 10 000. `150` is 1.5%.
- An amount is a whole, non-negative number of kobo. `30000` is ₦300.00. No decimals: money is
  integer kobo everywhere in Komtru, and a float in a money path is a bug.
- A minimum never exceeds its maximum. `max_minor: null` means no cap.
- Every key is known. A misspelled key is named rather than quietly ignored, so a fee cannot vanish
  because of a typo.

Fix the key it names, and the process starts.

## Why there is only one file

The guard in `scripts/test/support/fee-guard.ts` fails `pnpm test:repo` if backend module code
contains a numeric literal equal to a distinctive value in the fee file, reads `config/fees.yaml`
directly, or imports `computeTradeFees`, `snapshotFees` or `parseFeeSchedule` from
`@komtru/shared-types` instead of going through `src/modules/config`. It reads the source text
rather than the ESLint configuration, so turning off `komtru/module-boundaries` does not turn it off.

If it fires on you, the fix is almost always to take the amount from the trade's fee snapshot, or to
call `getFeeSchedule()` from the config module.

## What the guard does and does not catch

`pnpm test:repo` fails if backend module code outside `src/modules/config` contains a fee value from
`config/fees.yaml`, names the file, imports a fee symbol from `@komtru/shared-types` instead of the
config module, reaches past the module's barrel, or — in `ledger`, `trades`, `park` and `merchant` —
reads the _live_ schedule at all. Those modules must post from a trade's stored snapshot: recomputing
from the live file would reprice a trade that was already accepted.

It deliberately does not catch:

- values below 10, which are indistinguishable from an array index or a loop bound;
- a fee assembled by arithmetic (`15 * 10`) or written in another base — a text scanner cannot;
- anything outside `apps/backend-api/src/modules` (frontend bundles and database seeds are recorded
  as deferred on the ticket).

When a guarded number is genuinely not a fee, say so on the line rather than deleting the check:

```ts
const RETRY_WINDOW_MS = 30000; // fee-guard-ignore: a timeout, not the buyer-protection cap
```

The guard already ignores lines whose wording is plainly about time, size or counts, so this is for
the cases it cannot tell apart.
