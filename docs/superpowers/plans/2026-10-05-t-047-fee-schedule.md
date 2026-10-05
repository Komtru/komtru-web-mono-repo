# T-047 Fee Schedule File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One file, `config/fees.yaml`, is the only place a fee or a platform cut is set; a zod schema refuses a bad one at boot naming the key, one pure integer calculator turns it into trade amounts, and CI plus a guard test stop anyone from changing a value quietly or reading a fee any other way.

**Architecture:** `packages/shared-types/src/fees/schema.ts` owns the zod schema and the `FeeSchedule` type (money as `bigint` kobo, never `number`); `fees/calculator.ts` owns `computeTradeFees`, `snapshotFees` and `snapshotParkCashFee`, all pure and integer-only, built on `applyBps` from `money.ts`. The backend's first real domain module, `src/modules/config/`, reads and caches the file at boot and serves `GET /v1/config/fees`; its `index.ts` barrel is the only way in, so `komtru/module-boundaries` already stops a direct read of its internals. Two repo-level checks sit outside the apps: `tools/fee-version-check/` compares the file against `main` and fails on a changed value with no `version` bump, and a source scanner in `scripts/test/support/` fails on a fee literal or a fee read that goes round the module.

**Tech Stack:** zod 4, `yaml` 2.9.1, fast-check 4.10.2 (already a `@komtru/shared-types` devDependency), Vitest 5, Node 22 ESM.

**Spec:** design §6.5 and §5 (trade money flow) in `docs/superpowers/specs/2026-10-05-komtru-platform-design.md`; `docs/specs/module-08-payment-escrow-ledger.md` for the postings a snapshot feeds; ticket T-047 in `docs/tickets/04-files-notify-config.md`.

## Global Constraints

- The YAML values are copied **verbatim** from design §6.5: `version: 2026-10-05.1`, `currency: NGN`, `buyer_protection_fee.rate_bps: 150`, `min_minor: 0`, `max_minor: null`, `refundable_on_full_refund: true`, `seller_commission.rate_bps: 0`, `merchant_commission.rate_bps: 0`, `park_cash_handling_fee.min_minor: 30000` / `max_minor: 50000`, `payout_fee.amount_minor: 0`. No renaming, no rounding, no tidying.
- **Money is `bigint` kobo.** A JavaScript `number` never holds an amount. The YAML integer is validated with `Number.isSafeInteger` and converted to `bigint` at the schema boundary; from there nothing downstream is a `number` except `rateBps`, which is a basis-point count, not money.
- Rates are whole basis points, 0–10 000. Amounts are whole, non-negative kobo. A minimum never exceeds its maximum.
- Rounding is **half up to the kobo**, which is exactly what `applyBps(amount, bps)` already does (`(amount × bps + 5000) / 10000`, BigInt division truncating toward zero on non-negative operands). Nothing re-implements it.
- Errors naming a bad key follow `src/config/env.ts`: they name the key, never the value.
- TypeScript 6 strict, ESM with `.js` on relative imports, plain exported functions, exact dependency versions. Comments are sparse and say _why_.
- No infra tests. Nothing in this ticket touches Postgres, Redis or Docker.

## Review Focus

1. **A YAML scalar that is not what it looks like.** `max_minor: null` must decode to `null` and not to the string `"null"`; `version: 2026-10-05.1` must stay a string and not become a Date or a number. Task 1 asserts both against the real file.
2. **A float or an unsafe integer in the file.** `rate_bps: 1.5` or `min_minor: 1e20` must be rejected by name at boot, not silently truncated by `BigInt()` or `Number()`. Task 1.
3. **A minimum that cannot be satisfied.** If a commission's `min_minor` exceeds the item price, the seller would be paid a negative amount. Task 2 makes `computeTradeFees` throw naming the key rather than return a negative payout or silently drop the minimum.
4. **An unknown or misspelled key.** `buyer_protection_fees:` (plural) must fail the boot with that key named, not be ignored while the real fee silently reverts to nothing. Task 1 uses a strict object.
5. **A fee-file change that CI never sees.** `config/**` is outside every app workflow's derived path filter, so a commit touching only `config/fees.yaml` would run no app workflow at all. Task 5 puts the version check in the unfiltered `repo` workflow as well as the backend one, and pins both with a test.

---

### Task 1: `config/fees.yaml` and the zod schema

**Files:**

- Create: `config/fees.yaml`
- Create: `packages/shared-types/src/fees/schema.ts`
- Modify: `packages/shared-types/src/index.ts` (add `export * from './fees/schema.js';`)
- Test: `packages/shared-types/test/fees/schema.test.ts`
- Test: `packages/shared-types/test/index.test.ts` (add the new names to the public-surface list)

**Interfaces:**

- Consumes: `currencySchema`, `Currency` from `./enums.js`; `Kobo` from `./money.js`.
- Produces:

```ts
export const SELLER_KINDS = ['CASUAL', 'MERCHANT'] as const;
export const sellerKindSchema: z.ZodEnum<...>;
export type SellerKind = (typeof SELLER_KINDS)[number];

export interface FeeBand {
  rateBps: number;
  minMinor: Kobo;
  maxMinor: Kobo | null;
}
export interface FeeSchedule {
  version: string;
  currency: Currency;
  buyerProtectionFee: FeeBand & { refundableOnFullRefund: boolean };
  sellerCommission: FeeBand;
  merchantCommission: FeeBand;
  parkCashHandlingFee: { minMinor: Kobo; maxMinor: Kobo };
  payoutFee: { amountMinor: Kobo };
}

export const feeScheduleSchema: z.ZodType<FeeSchedule>;
export class FeeScheduleError extends Error {} // message lists every bad key, never a value
export function parseFeeSchedule(value: unknown, source?: string): FeeSchedule;
```

The schema reads the file's snake_case keys and produces camelCase fields: the YAML is the operator's surface, the TypeScript is the programmer's, and this is the one place the two are tied together. It is `.strict()` at every level so a misspelled key is named rather than ignored. `FeeScheduleError.message` is `` `<source> is invalid: ` `` followed by one `<dotted.key>: <reason>` per issue, joined by `; `.

- [ ] **Step 1: Write the failing tests** in `packages/shared-types/test/fees/schema.test.ts`

```ts
const valid = {
  version: '2026-10-05.1',
  currency: 'NGN',
  buyer_protection_fee: { rate_bps: 150, min_minor: 0, max_minor: null, refundable_on_full_refund: true },
  seller_commission: { rate_bps: 0, min_minor: 0, max_minor: null },
  merchant_commission: { rate_bps: 0, min_minor: 0, max_minor: null },
  park_cash_handling_fee: { min_minor: 30000, max_minor: 50000 },
  payout_fee: { amount_minor: 0 },
};

it('turns the file into integer kobo and camelCase fields', () => {
  const schedule = parseFeeSchedule(valid);
  expect(schedule.buyerProtectionFee).toEqual({
    rateBps: 150,
    minMinor: 0n,
    maxMinor: null,
    refundableOnFullRefund: true,
  });
  expect(schedule.parkCashHandlingFee).toEqual({ minMinor: 30000n, maxMinor: 50000n });
  expect(schedule.payoutFee.amountMinor).toBe(0n);
});

it.each([
  [
    'buyer_protection_fee.rate_bps',
    { buyer_protection_fee: { ...valid.buyer_protection_fee, rate_bps: 1.5 } },
  ],
  [
    'buyer_protection_fee.rate_bps',
    { buyer_protection_fee: { ...valid.buyer_protection_fee, rate_bps: 10001 } },
  ],
  ['seller_commission.min_minor', { seller_commission: { rate_bps: 0, min_minor: -1, max_minor: null } }],
  ['seller_commission.min_minor', { seller_commission: { rate_bps: 0, min_minor: 1e20, max_minor: null } }],
  ['merchant_commission.max_minor', { merchant_commission: { rate_bps: 0, min_minor: 500, max_minor: 100 } }],
  ['park_cash_handling_fee.max_minor', { park_cash_handling_fee: { min_minor: 50000, max_minor: 30000 } }],
  ['version', { version: 'yesterday' }],
  ['currency', { currency: 'USD' }],
])('names %s as the bad key', (key, patch) => {
  const error = (() => {
    try {
      parseFeeSchedule({ ...valid, ...patch }, 'config/fees.yaml');
    } catch (e) {
      return e as Error;
    }
  })();
  expect(error).toBeInstanceOf(FeeScheduleError);
  expect(error!.message).toContain('config/fees.yaml is invalid');
  expect(error!.message).toContain(key);
});

it('names an unknown key instead of ignoring it', () => {
  expect(() => parseFeeSchedule({ ...valid, buyer_protection_fees: {} })).toThrow(/buyer_protection_fees/);
});

it('never puts a configured value in the error message', () => {
  // 424242 is a value an operator typed; the message names the key, as src/config/env.ts does.
  const error = (() => {
    try {
      parseFeeSchedule({
        ...valid,
        buyer_protection_fee: { ...valid.buyer_protection_fee, rate_bps: 424242 },
      });
    } catch (e) {
      return e as Error;
    }
  })();
  expect(error!.message).not.toContain('424242');
});
```

And in the same file, the real-file test, which is what makes this schema a check on `config/fees.yaml` rather than on a literal in a test:

```ts
const text = readFileSync(resolve(import.meta.dirname, '../../../../config/fees.yaml'), 'utf8');
const raw = parse(text) as unknown; // `yaml`

it('parses the committed config/fees.yaml with design §6.5 values', () => {
  const schedule = parseFeeSchedule(raw, 'config/fees.yaml');
  expect(schedule.version).toBe('2026-10-05.1');
  expect(schedule.currency).toBe('NGN');
  expect(schedule.buyerProtectionFee.rateBps).toBe(150);
  expect(schedule.buyerProtectionFee.refundableOnFullRefund).toBe(true);
  expect(schedule.sellerCommission.rateBps).toBe(0);
  expect(schedule.merchantCommission.rateBps).toBe(0);
  expect(schedule.parkCashHandlingFee).toEqual({ minMinor: 30000n, maxMinor: 50000n });
  expect(schedule.payoutFee.amountMinor).toBe(0n);
});

it('keeps version a string and max_minor a real null', () => {
  const object = raw as Record<string, unknown>;
  expect(typeof object.version).toBe('string');
  expect((object.buyer_protection_fee as Record<string, unknown>).max_minor).toBeNull();
});
```

- [ ] **Step 2: Run them and watch them fail** — `pnpm --filter @komtru/shared-types exec vitest run test/fees/schema.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Write `config/fees.yaml`**, copying design §6.5's block verbatim, and prepend the runbook header:

```yaml
# config/fees.yaml — the only place fees and cuts are set (design §6.5).
#
# To change a fee safely:
#   1. Edit the value here. Nowhere else: no code, no seed, no frontend.
#   2. Bump `version` (date.counter, e.g. 2026-10-05.2). CI fails on a changed value without it.
#   3. Open a PR. Git history is the audit trail.
#   4. Deploy. Trades already created keep the fees they were snapshotted under.
# Full runbook: docs/runbooks/fees.md
```

- [ ] **Step 4: Implement `packages/shared-types/src/fees/schema.ts`.** `rate_bps` is `z.int().min(0).max(10_000)`; an amount is `z.int().min(0).max(Number.MAX_SAFE_INTEGER).transform(BigInt)` (`z.int()` already rejects a non-integer and a non-safe integer); every object is `.strict()`; a band carries `.refine` for min ≤ max, attached with `path: ['max_minor']`. `parseFeeSchedule` uses `safeParse` and turns `error.issues` into one `FeeScheduleError` listing `issue.path.join('.')` and `issue.message`, with no `issue.input` anywhere.

- [ ] **Step 5: Add `export * from './fees/schema.js';`** to `packages/shared-types/src/index.ts` and add `feeScheduleSchema`, `parseFeeSchedule`, `sellerKindSchema` to the list in `test/index.test.ts`.

- [ ] **Step 6: Run the package suite and watch it pass** — `pnpm --filter @komtru/shared-types exec vitest run`.

- [ ] **Step 7: Commit** `feat(shared-types): add the fee schedule file and its schema`.

### Task 2: `computeTradeFees`

**Files:**

- Create: `packages/shared-types/src/fees/calculator.ts`
- Modify: `packages/shared-types/src/index.ts`
- Test: `packages/shared-types/test/fees/calculator.test.ts`

**Interfaces:**

- Consumes: `FeeSchedule`, `FeeBand`, `SellerKind` (Task 1); `Kobo`, `applyBps` from `./money.js`.
- Produces:

```ts
export interface TradeFees {
  itemMinor: Kobo;
  /** Paid by the buyer on top of the item price. */
  buyerProtectionFeeMinor: Kobo;
  /** What the buyer funds: itemMinor + buyerProtectionFeeMinor. */
  buyerTotalMinor: Kobo;
  /** The platform's cut of the seller's proceeds at release. */
  commissionMinor: Kobo;
  /** Credited to the seller at release: itemMinor - commissionMinor. */
  sellerProceedsMinor: Kobo;
  /** Recognised as revenue: buyerProtectionFeeMinor + commissionMinor. */
  platformRevenueMinor: Kobo;
}
export function computeTradeFees(itemMinor: Kobo, sellerKind: SellerKind, schedule: FeeSchedule): TradeFees;
```

The split follows design §5: "The funding total is the item price plus the buyer protection fee. On release the seller is credited the item price minus any seller or merchant commission, and the fee and commission are recognised as revenue." `sellerKind` picks `sellerCommission` for `CASUAL` and `merchantCommission` for `MERCHANT`. `park_cash_handling_fee` and `payout_fee` are deliberately absent: the Park fee is cash the buyer hands an agent and never enters Komtru's books (C23), and the payout fee is charged per withdrawal, not per trade.

- [ ] **Step 1: Write the failing tests.**

Exact-value tests, with the committed schedule (buyer protection 150 bps, both commissions 0):

```ts
it('adds the buyer protection fee on top and leaves the seller whole', () => {
  const fees = computeTradeFees(5_000_000n, 'CASUAL', committed); // ₦50,000
  expect(fees).toEqual({
    itemMinor: 5_000_000n,
    buyerProtectionFeeMinor: 75_000n, // ₦750 = 1.5%
    buyerTotalMinor: 5_075_000n,
    commissionMinor: 0n,
    sellerProceedsMinor: 5_000_000n,
    platformRevenueMinor: 75_000n,
  });
});

it.each([
  [100n, 2n], // 1.50 kobo exactly -> half up
  [300n, 5n], // 4.50 kobo exactly -> half up
  [99n, 1n], // 1.485 -> down
  [101n, 2n], // 1.515 -> up
  [0n, 0n],
])('rounds %s kobo of item price to a %s kobo fee, half up', (itemMinor, expected) => {
  expect(computeTradeFees(itemMinor, 'CASUAL', committed).buyerProtectionFeeMinor).toBe(expected);
});

it('charges a merchant the merchant commission and a casual seller the seller one', () => {
  const schedule = withBands({ seller: { rateBps: 100 }, merchant: { rateBps: 250 } });
  expect(computeTradeFees(1_000_000n, 'CASUAL', schedule).commissionMinor).toBe(10_000n);
  expect(computeTradeFees(1_000_000n, 'MERCHANT', schedule).commissionMinor).toBe(25_000n);
});

it('holds a minimum and a cap at their exact boundaries', () => {
  const schedule = withBands({ buyerProtection: { rateBps: 150, minMinor: 10_000n, maxMinor: 50_000n } });
  expect(computeTradeFees(0n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(10_000n);
  expect(computeTradeFees(666_667n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(10_000n); // 10,000.005 -> 10,000 is above the minimum, unclamped
  expect(computeTradeFees(3_333_333n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(50_000n); // exactly the cap
  expect(computeTradeFees(100_000_000n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(50_000n);
});

it('refuses a commission minimum the item price cannot cover, naming the key', () => {
  const schedule = withBands({ seller: { rateBps: 0, minMinor: 100n, maxMinor: null } });
  expect(() => computeTradeFees(50n, 'CASUAL', schedule)).toThrow(/seller_commission\.min_minor/);
});

it('refuses an item price that is not non-negative integer kobo', () => {
  expect(() => computeTradeFees(-1n, 'CASUAL', committed)).toThrow(RangeError);
  expect(() => computeTradeFees(1.5 as unknown as Kobo, 'CASUAL', committed)).toThrow(TypeError);
});

it('never charges the park cash handling fee or the payout fee on a trade', () => {
  const fees = computeTradeFees(5_000_000n, 'CASUAL', committed);
  expect(Object.values(fees)).not.toContain(30_000n);
  expect(fees.buyerTotalMinor).toBe(5_075_000n);
});
```

Property tests with `fast-check`, over an arbitrary item price and an arbitrary schedule (`rateBps` 0–10 000, `minMinor` 0–10⁶, `maxMinor` null or ≥ `minMinor`), with item prices drawn ≥ every commission minimum so the throw above is out of scope:

```ts
it('always has the total equal the parts', () => {
  /* buyerTotal === item + fee;
     item === sellerProceeds + commission; platformRevenue === fee + commission;
     buyerTotal === sellerProceeds + platformRevenue */
});
it('never produces anything but a bigint', () => {
  /* every value typeof 'bigint';
     JSON.stringify(result, bigintToString) matches /^-?\d+$/ per field — no '.', no 'e' */
});
it('always holds the minimum and the cap', () => {
  /* min <= fee, and fee <= max when max !== null */
});
it('never pays a seller a negative amount or charges a buyer less than the item', () => {
  /* sellerProceeds >= 0n; buyerTotal >= item */
});
```

- [ ] **Step 2: Run them and watch them fail** — `pnpm --filter @komtru/shared-types exec vitest run test/fees/calculator.test.ts`. Expected: FAIL, `computeTradeFees` is not a function.

- [ ] **Step 3: Implement `calculator.ts`.** One unexported `band(amount, band, keyName)` applies `applyBps`, then clamps to `minMinor` and (when not `null`) `maxMinor`. The commission call additionally throws `RangeError('<keyName>.min_minor exceeds the item price, which would pay the seller a negative amount')` when the clamped commission would exceed `itemMinor` — a configuration that cannot be honoured is louder than a silently dropped minimum or a negative payout. Guard `itemMinor` with `typeof itemMinor !== 'bigint'` → `TypeError`, `itemMinor < 0n` → `RangeError`.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Export from the barrel** and add `computeTradeFees` to `test/index.test.ts`'s list.

- [ ] **Step 6: Commit** `feat(shared-types): add the integer trade fee calculator`.

### Task 3: `snapshotFees`

**Files:**

- Modify: `packages/shared-types/src/fees/calculator.ts`
- Test: `packages/shared-types/test/fees/calculator.test.ts`

**Interfaces:**

- Produces:

```ts
export interface FeeSnapshot {
  /** The `version` of config/fees.yaml these amounts came from. */
  version: string;
  currency: Currency;
  /** ISO-8601 instant the snapshot was taken, so an audit can line it up with git history. */
  takenAt: string;
  sellerKind: SellerKind;
  /** Amounts in kobo as decimal digit strings: this is stored as JSONB and crosses the wire,
   *  where a JSON number would lose kobo past 2^53. */
  amounts: {
    itemMinor: string;
    buyerProtectionFeeMinor: string;
    buyerTotalMinor: string;
    commissionMinor: string;
    sellerProceedsMinor: string;
    platformRevenueMinor: string;
  };
  /** The terms the amounts were derived under, so a later reader can re-derive them without the file. */
  terms: {
    buyerProtectionBps: number;
    buyerProtectionMinMinor: string;
    buyerProtectionMaxMinor: string | null;
    buyerProtectionRefundableOnFullRefund: boolean;
    commissionBps: number;
    commissionMinMinor: string;
    commissionMaxMinor: string | null;
  };
}
export const feeSnapshotSchema: z.ZodType<FeeSnapshot>;
export function snapshotFees(
  itemMinor: Kobo,
  sellerKind: SellerKind,
  schedule: FeeSchedule,
  takenAt?: Date,
): FeeSnapshot;

export interface ParkCashFeeSnapshot {
  version: string;
  currency: Currency;
  takenAt: string;
  minMinor: string;
  maxMinor: string;
}
export function snapshotParkCashFee(schedule: FeeSchedule, takenAt?: Date): ParkCashFeeSnapshot;
```

Why this shape: design §6.5 says every ledger posting uses the snapshot and never the live file, so the snapshot has to carry **every number a posting needs** (`amounts`) and **every term a later decision needs** (`terms`) — chiefly `buyerProtectionRefundableOnFullRefund`, because Q4's refund treatment must be the one in force when the trade was accepted, not the one in force when the refund happens. `version` plus `takenAt` make it auditable against git history without duplicating the whole file. `snapshotParkCashFee` exists because §6.5 also requires "a Park parcel snapshots the handling fee when it is created", and a Park ticket inventing its own shape would be a second money vocabulary.

- [ ] **Step 1: Write the failing tests.**

```ts
it('carries the version, the amounts and the terms they came from', () => {
  const snapshot = snapshotFees(5_000_000n, 'CASUAL', committed, new Date('2026-10-05T09:00:00.000Z'));
  expect(snapshot).toEqual({
    version: '2026-10-05.1',
    currency: 'NGN',
    takenAt: '2026-10-05T09:00:00.000Z',
    sellerKind: 'CASUAL',
    amounts: {
      itemMinor: '5000000',
      buyerProtectionFeeMinor: '75000',
      buyerTotalMinor: '5075000',
      commissionMinor: '0',
      sellerProceedsMinor: '5000000',
      platformRevenueMinor: '75000',
    },
    terms: {
      buyerProtectionBps: 150,
      buyerProtectionMinMinor: '0',
      buyerProtectionMaxMinor: null,
      buyerProtectionRefundableOnFullRefund: true,
      commissionBps: 0,
      commissionMinMinor: '0',
      commissionMaxMinor: null,
    },
  });
});

it('survives JSON without losing a kobo', () => {
  const snapshot = snapshotFees(9_007_199_254_740_993n, 'MERCHANT', committed);
  expect(feeSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  expect(snapshot.amounts.itemMinor).toBe('9007199254740993');
});

it('agrees with computeTradeFees for every input', () => {
  /* fast-check: amounts === the
   computeTradeFees result stringified */
});

it('is unaffected by a later edit to the schedule it came from', () => {
  const snapshot = snapshotFees(5_000_000n, 'CASUAL', committed);
  const changed = withBands({ buyerProtection: { rateBps: 900 } });
  expect(snapshotFees(5_000_000n, 'CASUAL', changed).amounts.buyerProtectionFeeMinor).not.toBe(
    snapshot.amounts.buyerProtectionFeeMinor,
  );
  expect(snapshot.amounts.buyerProtectionFeeMinor).toBe('75000');
});

it('snapshots the park cash handling fee range as display-only amounts', () => {
  expect(snapshotParkCashFee(committed, new Date('2026-10-05T09:00:00.000Z'))).toEqual({
    version: '2026-10-05.1',
    currency: 'NGN',
    takenAt: '2026-10-05T09:00:00.000Z',
    minMinor: '30000',
    maxMinor: '50000',
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement both functions** in `calculator.ts` plus `feeSnapshotSchema` (a `.strict()` object whose amount fields are `z.string().regex(/^\d{1,19}$/)`, mirroring `KOBO_WIRE`). `takenAt` defaults to `new Date()`.
- [ ] **Step 4: Run them and watch them pass.**
- [ ] **Step 5: Export from the barrel**, add `snapshotFees` and `feeSnapshotSchema` to `test/index.test.ts`.
- [ ] **Step 6: Commit** `feat(shared-types): add fee snapshots for trades and park parcels`.

### Task 4: The backend fee module and `GET /config/fees`

**Files:**

- Create: `apps/backend-api/src/modules/config/fees.ts`
- Create: `apps/backend-api/src/modules/config/routes.ts`
- Create: `apps/backend-api/src/modules/config/index.ts`
- Modify: `apps/backend-api/src/modules/index.ts` (register the module)
- Modify: `apps/backend-api/package.json` (add `"yaml": "2.9.1"` to `dependencies`)
- Test: `apps/backend-api/test/modules/config/fees.test.ts`
- Test: `apps/backend-api/test/modules/config/routes.test.ts`

**Interfaces:**

- Consumes: `parseFeeSchedule`, `FeeSchedule`, `FeeScheduleError`, `snapshotFees`, `SellerKind`, `Kobo` from `@komtru/shared-types`; `defineRoute` from `../../platform/http/route.js`; `defineModule` from `../../platform/module.js`.
- Produces, from `src/modules/config/index.ts` — the only way in, enforced by `komtru/module-boundaries`:

```ts
export const configModule: KomtruModule; // name: 'config', routes: [feesRoute]
export function getFeeSchedule(): FeeSchedule; // cached; first call reads and validates the file
export function snapshotFees(itemMinor: Kobo, sellerKind: SellerKind): FeeSnapshot; // live schedule
export const feeScheduleResponseSchema: z.ZodType; // the display DTO GET /config/fees returns
```

`fees.ts` also exports, for its own tests, `loadFeeSchedule(text: string, source: string): FeeSchedule` (pure) and `findFeesFile(from: string): string`, which walks up from `import.meta.dirname` for a directory containing `config/fees.yaml`. The walk is how one file serves `src/` under `tsx`, `dist/` under `node`, and a test run, without a build step that copies it or an environment variable that could point somewhere else.

The module is loaded by `src/modules/index.ts`, which `server.ts` imports, so a schedule that fails validation throws before the process listens — the file is read eagerly in the module body, not lazily on first request.

- [ ] **Step 1: Write the failing tests** in `test/modules/config/fees.test.ts`

```ts
it('reads the committed file and exposes it', () => {
  const schedule = getFeeSchedule();
  expect(schedule.version).toBe('2026-10-05.1');
  expect(schedule.buyerProtectionFee.rateBps).toBe(150);
});

it('returns the same object on every call, so nothing re-reads the file per request', () => {
  expect(getFeeSchedule()).toBe(getFeeSchedule());
});

it('refuses an invalid file, naming the bad key and not its value', () => {
  const bad = VALID_YAML.replace('rate_bps: 150', 'rate_bps: 150.5');
  const error = (() => {
    try {
      loadFeeSchedule(bad, 'config/fees.yaml');
    } catch (e) {
      return e as Error;
    }
  })();
  expect(error).toBeInstanceOf(FeeScheduleError);
  expect(error!.message).toContain('buyer_protection_fee.rate_bps');
  expect(error!.message).not.toContain('150.5');
});

it('refuses a file that is not YAML at all, naming the file', () => {
  expect(() => loadFeeSchedule('{{{', 'config/fees.yaml')).toThrow(/config\/fees\.yaml/);
});

it('snapshots at the live schedule', () => {
  expect(snapshotFees(5_000_000n, 'CASUAL').amounts.buyerTotalMinor).toBe('5075000');
});

it('finds config/fees.yaml from the compiled output directory too', () => {
  expect(findFeesFile(resolve(import.meta.dirname, '../../../dist/modules/config'))).toBe(
    resolve(import.meta.dirname, '../../../../../config/fees.yaml'),
  );
});
```

and in `test/modules/config/routes.test.ts`, mounted the way `test/platform/http/mount.test.ts` mounts routes:

```ts
it('serves the current schedule for display, with money as strings', async () => {
  const response = await request(appWith(configModule.routes!)).get('/v1/config/fees').expect(200);
  expect(response.body).toEqual({
    version: '2026-10-05.1',
    currency: 'NGN',
    buyerProtectionFee: { rateBps: 150, minMinor: '0', maxMinor: null, refundableOnFullRefund: true },
    sellerCommission: { rateBps: 0, minMinor: '0', maxMinor: null },
    merchantCommission: { rateBps: 0, minMinor: '0', maxMinor: null },
    parkCashHandlingFee: { minMinor: '30000', maxMinor: '50000' },
    payoutFee: { amountMinor: '0' },
  });
});

it('passes the route registry invariants', () => {
  expect(() => assertRouteInvariants(configModule.routes!)).not.toThrow();
});
```

- [ ] **Step 2: Run them and watch them fail** — `pnpm --filter @komtru/backend-api exec vitest run test/modules/config`. Expected: FAIL, module not found.

- [ ] **Step 3: Add `"yaml": "2.9.1"` to `apps/backend-api/package.json` dependencies and `pnpm install`.**

- [ ] **Step 4: Implement `fees.ts` and `routes.ts`.** `loadFeeSchedule` wraps `parse(text)` from `yaml` in a try/catch that rethrows as `FeeScheduleError` naming the source. The route is `defineRoute({ method: 'get', path: '/config/fees', scope: 'PUBLIC', summary: 'The current fee schedule, for display', schema: { response: feeScheduleResponseSchema }, handler: ... })` — not a collection, so no `paginated`; not mutating, so no `retryable`. `PUBLIC` because a published fee table is what a buyer needs before they have a session.

- [ ] **Step 5: Create `index.ts`** re-exporting `configModule`, `getFeeSchedule`, `snapshotFees` and `feeScheduleResponseSchema`, and register `configModule` in `src/modules/index.ts`.

- [ ] **Step 6: Run the backend unit suite and watch it pass** — `pnpm --filter @komtru/backend-api exec vitest run` (the `*.int.test.ts` suites skip without `KOMTRU_INFRA_TESTS`).

- [ ] **Step 7: Commit** `feat(backend-api): add the config module serving the fee schedule`.

### Task 5: The version check and its CI steps

**Files:**

- Create: `tools/fee-version-check/check.mjs`, `tools/fee-version-check/check.d.mts`, `tools/fee-version-check/cli.mjs`
- Test: `scripts/test/fee-version-check.test.ts`
- Modify: `.github/workflows/backend-api.yml` (a step in `lint`), `.github/workflows/repo.yml` (a step in `checks`)
- Modify: `scripts/test/ci-workflows.test.ts` (assert both steps exist)

**Interfaces:**

- Produces:

```ts
export declare function findVersionProblems(baseText: string | null, headText: string): string[];
```

`baseText` is `null` when the file does not exist on the base ref (the commit that adds it), which is never a problem. The function parses both with `yaml`, compares every leaf except `version`, and returns one problem per changed dotted key when `version` is unchanged; it also reports a `version` that moved backwards or stayed equal while values changed. Pure, so it is testable without git; `cli.mjs` is the only part that shells out.

- [ ] **Step 1: Write the failing tests** in `scripts/test/fee-version-check.test.ts`

```ts
it('accepts an unchanged file', () => expect(findVersionProblems(base, base)).toEqual([]));
it('accepts the commit that adds the file', () => expect(findVersionProblems(null, base)).toEqual([]));
it('accepts a value change with a version bump', () => {
  const head = base.replace('rate_bps: 150', 'rate_bps: 200').replace('2026-10-05.1', '2026-10-05.2');
  expect(findVersionProblems(base, head)).toEqual([]);
});
it('rejects a value change with no version bump, naming the key', () => {
  const problems = findVersionProblems(base, base.replace('rate_bps: 150', 'rate_bps: 200'));
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('buyer_protection_fee.rate_bps');
  expect(problems[0]).toContain('version');
});
it('names every changed key, not just the first', () => {
  const head = base
    .replace('min_minor: 30000', 'min_minor: 40000')
    .replace('amount_minor: 0', 'amount_minor: 5000');
  expect(findVersionProblems(base, head)).toHaveLength(2);
});
it('rejects a removed and an added key', () => {
  /* delete payout_fee; add a new top-level key */
});
it('accepts a comment-only or whitespace-only edit', () => {
  expect(findVersionProblems(base, `# a new note\n${base}`)).toEqual([]);
});
it('rejects a version that goes backwards', () => {
  const head = base.replace('rate_bps: 150', 'rate_bps: 200').replace('2026-10-05.1', '2026-10-04.1');
  expect(findVersionProblems(base, head)).toEqual([expect.stringContaining('version')]);
});
```

Plus the real-file guard, so the check is wired to the committed file and not only to fixtures:

```ts
it('is clean for the committed config/fees.yaml against itself', () => {
  const text = readFileSync(resolve(repoRoot, 'config/fees.yaml'), 'utf8');
  expect(findVersionProblems(text, text)).toEqual([]);
});
```

- [ ] **Step 2: Run them and watch them fail** — `pnpm test:repo -- fee-version-check`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `check.mjs` and `check.d.mts`.** Flatten each parsed document to a `Map<dottedKey, scalar>` and diff the two maps. Version ordering compares the `YYYY-MM-DD` part lexically then the counter numerically.

- [ ] **Step 4: Implement `cli.mjs`.** Takes the base ref as `argv[2]`, defaulting to `origin/main`; reads the base file with `git show <ref>:config/fees.yaml` (`execFileSync`), treating a non-zero exit as "the file is not on that ref" → `null`; prints each problem to stderr and exits 1, or prints nothing and exits 0.

- [ ] **Step 5: Add the CI steps.** In `backend-api.yml`'s `lint` job and `repo.yml`'s `checks` job, after the setup step:

```yaml
- name: Fee schedule version
  # A fee value may not change without a `version` bump (design §6.5). `config/**` is outside
  # every app workflow's path filter, so this also runs in the unfiltered repo workflow —
  # otherwise a commit touching only config/fees.yaml would be checked by nothing.
  run: |
    git fetch --no-tags --depth=1 origin main
    node tools/fee-version-check/cli.mjs FETCH_HEAD
```

- [ ] **Step 6: Write the failing workflow-shape test** in `scripts/test/ci-workflows.test.ts`

```ts
describe('fee schedule version check', () => {
  const runsOf = (file: string, job: string) =>
    readYaml<Workflow>(file)
      .jobs[job]!.steps.map((step) => step.run ?? '')
      .join('\n');

  it('runs in the backend workflow and in the unfiltered repo workflow', () => {
    for (const [file, job] of [
      ['.github/workflows/backend-api.yml', 'lint'],
      ['.github/workflows/repo.yml', 'checks'],
    ] as const) {
      expect(runsOf(file, job)).toContain('tools/fee-version-check/cli.mjs');
    }
  });

  it('is not left to a path filter that excludes config/', () => {
    const paths = readYaml<Workflow>('.github/workflows/backend-api.yml').on.pull_request?.paths ?? [];
    expect(paths.some((p) => p.startsWith('config/'))).toBe(false);
    expect(readYaml<Workflow>('.github/workflows/repo.yml').on.pull_request?.paths).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run the repo suite and watch it pass** — `pnpm test:repo`. Every existing `ci-workflows` assertion must still pass: the job list for `backend-api` is unchanged (a step, not a job), so `Object.keys(jobs)` still equals `['lint','typecheck','test','build','deploy']`.

- [ ] **Step 8: Commit** `feat(tools): fail ci on a fee change without a version bump`.

### Task 6: The guard against fee literals and fee reads that bypass the module

**Files:**

- Create: `scripts/test/support/fee-guard.ts`
- Test: `scripts/test/fee-guard.test.ts`

**Interfaces:**

- Produces:

```ts
export interface FeeGuardViolation {
  file: string; // relative to the scanned root
  line: number;
  detail: string; // the literal or the import specifier
  kind: 'fee-literal' | 'fee-read-bypass';
}
export function feeValuesToGuard(scheduleText: string): string[];
export async function findFeeViolations(root: string, values: string[]): Promise<FeeGuardViolation[]>;
```

A second, deliberately independent check, like `apps/backend-api/test/support/provider-imports.ts`: it reads the source text, so it is what still fails if `komtru/module-boundaries` is disabled or an exemption comment is added. `feeValuesToGuard` takes the distinctive scalars out of `config/fees.yaml` — every numeric value whose absolute value is at least 10 (`150`, `30000`, `50000`), plus the `version` string. Values below 10 (`0`, the booleans) are not guarded, because a `0` in a loop bound is not a fee and a guard that fires on it would be turned off within a week; the module boundary covers those.

`fee-read-bypass` fires when a file outside `modules/config/` either names `fees.yaml`, or imports one of `computeTradeFees`, `snapshotFees`, `parseFeeSchedule`, `feeScheduleSchema` directly from `@komtru/shared-types` — ledger, trades, park and merchant code must take amounts from the trade's snapshot or from the `config` module, never recompute them from the live file.

- [ ] **Step 1: Write the failing tests** in `scripts/test/fee-guard.test.ts`, using a throwaway tree the way `provider-boundaries.test.ts` does:

```ts
it('takes the distinctive values out of the fee file and leaves 0 alone', () => {
  expect(feeValuesToGuard(feesText)).toEqual(
    expect.arrayContaining(['150', '30000', '50000', '2026-10-05.1']),
  );
  expect(feeValuesToGuard(feesText)).not.toContain('0');
});

it('finds a fee literal in ledger code', async () => {
  const root = await tree({ 'ledger/services/release.service.ts': 'const fee = applyBps(amount, 150n);\n' });
  await expect(findFeeViolations(root, VALUES)).resolves.toMatchObject([
    { file: 'ledger/services/release.service.ts', kind: 'fee-literal', detail: '150' },
  ]);
});

it.each(['const min = 30000;', 'const min = 30_000n;', "const v = '2026-10-05.1';"])(
  'finds the fee literal in %s',
  async (code) => {
    /* park/services/parcel.service.ts -> one violation */
  },
);

it('finds a file reading config/fees.yaml directly', async () => {
  const root = await tree({
    'trades/services/terms.service.ts': "readFileSync('../../config/fees.yaml');\n",
  });
  await expect(findFeeViolations(root, VALUES)).resolves.toMatchObject([{ kind: 'fee-read-bypass' }]);
});

it('finds a module computing fees itself instead of using the snapshot', async () => {
  const root = await tree({
    'trades/services/terms.service.ts': "import { computeTradeFees } from '@komtru/shared-types';\n",
  });
  await expect(findFeeViolations(root, VALUES)).resolves.toMatchObject([{ kind: 'fee-read-bypass' }]);
});

it('lets the config module itself hold the values and the imports', async () => {
  const root = await tree({
    'config/fees.ts':
      "import { parseFeeSchedule } from '@komtru/shared-types';\nconst f = '../../../config/fees.yaml';\n",
  });
  await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
});

it('lets a module import the fee module through its barrel', async () => {
  const root = await tree({
    'trades/services/terms.service.ts': "import { snapshotFees } from '../../config/index.js';\n",
  });
  await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
});

it('ignores a number that merely contains a fee value', async () => {
  const root = await tree({ 'ledger/services/x.ts': 'const port = 1500;\nconst ms = 300000;\n' });
  await expect(findFeeViolations(root, VALUES)).resolves.toEqual([]);
});

describe('apps/backend-api/src/modules', () => {
  it('has no fee literal and no fee read outside the config module', async () => {
    const root = resolve(repoRoot, 'apps/backend-api/src/modules');
    expect(existsSync(root)).toBe(true); // the scan is silent about a missing root
    expect(existsSync(resolve(root, 'config'))).toBe(true); // and the config module is the thing it exempts
    await expect(findFeeViolations(root, feeValuesToGuard(feesText))).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail** — `pnpm test:repo -- fee-guard`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `scripts/test/support/fee-guard.ts`.** Walk `.ts` files under the root. Numeric literals are matched with a word-boundary pattern that tolerates `_` separators and a `n` suffix (`/(?<![\w.])\d[\d_]*n?(?![\w.])/g`), normalised by stripping `_` and `n`, then compared against the guarded set — so `1500` and `300000` do not match `150` or `30000`. Skip any file whose path's first segment is `config`.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Prove the guard is not vacuous.** Temporarily add `const fee = 150;` to a scratch file under `apps/backend-api/src/modules/identity/`, run `pnpm test:repo -- fee-guard`, confirm the real-tree test FAILS naming that file, then delete the scratch file and confirm it passes again. Record both outcomes in the commit message body.

- [ ] **Step 6: Commit** `test(repo): guard against fee literals and fee reads outside the fee module`.

### Task 7: The runbook

**Files:**

- Create: `docs/runbooks/fees.md`
- Modify: `docs/tickets/04-files-notify-config.md` (T-047 status)

- [ ] **Step 1: Write `docs/runbooks/fees.md`** in the style of `docs/runbooks/local-dev.md`: what the file is and why there is only one; the four-step change procedure from the file's own header, expanded (edit the value; bump `version`; what CI will say if you forget; what deploying does and does not change); why an open trade keeps its old fees (the snapshot) and therefore what a fee change does and does not affect; how to read `GET /v1/config/fees` to confirm what production is serving; and what to do when the backend refuses to start on an invalid file (the error names the key).

- [ ] **Step 2: Check the two runbooks agree** — the header in `config/fees.yaml` links to `docs/runbooks/fees.md`, and the runbook quotes the same four steps. Verify by reading both.

- [ ] **Step 3: Mark T-047 done** in `docs/tickets/04-files-notify-config.md` with `- **Status:** Done (2026-10-05). Plan: docs/superpowers/plans/2026-10-05-t-047-fee-schedule.md` and a `- **Deferred:** …` line. Do not run `pnpm tickets:index`.

- [ ] **Step 4: Full verification** — `pnpm exec turbo run build lint typecheck test --force`, `pnpm exec prettier --check .`, `pnpm test:repo`. Record the test counts.

- [ ] **Step 5: Commit** `docs(runbooks): explain how to change a fee safely`.
