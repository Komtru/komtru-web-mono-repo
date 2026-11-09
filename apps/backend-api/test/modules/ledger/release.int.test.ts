// T-074 end to end against a real Postgres: a funded trade completes, the ledger settles it once,
// and what the ledger holds for that trade afterwards is nothing.
//
// The assertions are balances, not line counts. A posting can be internally balanced and still be
// wrong — debiting the buyer total instead of the item balances perfectly and overdraws the escrow
// liability by the fee — so what these tests check is that every account the trade touched is left
// exactly where it should be, and that the deferred balance invariant (migration 0017) never fires.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { createLogger } from '../../../src/platform/logger.js';
import { loadConfig } from '../../../src/config/env.js';
import {
  accountBalance,
  postJournal,
  releaseEscrow,
  trialBalance,
  type AccountRef,
  type ReleaseResult,
} from '../../../src/modules/ledger/index.js';
import {
  fundingJournalLines,
  IdempotencyKeyConflictError,
  ReleaseSnapshotError,
  ReleaseSplitError,
  releaseIdempotencyKey,
  type DisputeSplit,
} from '../../../src/modules/ledger/index.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  ROUTES,
  feeSnapshotColumnValues,
  insertRow,
  insertTermsVersion,
  insertTrade,
  insertUser,
  transition,
} from '../trades/support.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
});
const logger = createLogger(config);
const deps = { logger };

const ITEM = 45_000_000n;
const FEE = 675_000n;
const COMMISSION = 1_125_000n;
const PROCEEDS = ITEM - COMMISSION;

describe.runIf(infraEnabled)('releasing a trade (T-074)', () => {
  const t = useTestDatabase();

  let buyer: string;
  let seller: string;
  let tradeId: string;

  const ESCROW = (): AccountRef => ({ type: 'USER_ESCROW_LIABILITY', tradeId });
  const FEE_LIABILITY = (): AccountRef => ({ type: 'BUYER_PROTECTION_FEE_LIABILITY', tradeId });
  const PAYABLE = (): AccountRef => ({ type: 'USER_PAYABLE', ownerUserId: seller });
  const POOL: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
  const COMMISSION_REVENUE: AccountRef = { type: 'PLATFORM_FEE_REVENUE' };
  const FEE_REVENUE: AccountRef = { type: 'BUYER_PROTECTION_FEE_REVENUE' };

  const balance = async (ref: AccountRef) => (await accountBalance(t.db(), ref)).balanceMinor;

  /** Walks a trade to `status`, freezing the fee snapshot the test asked for at acceptance. */
  const driveWithFees = async (
    target: string,
    item = ITEM,
    fee = FEE,
    commission = COMMISSION,
  ): Promise<void> => {
    const terms = await insertTermsVersion(t.app(), tradeId, buyer, {
      item_amount_minor: item.toString(),
    });
    for (const step of ROUTES[target] ?? []) {
      const extra = step.fees
        ? { ...feeSnapshotColumnValues(item, fee, commission), accepted_terms_version_id: terms }
        : {};
      await transition(t.app(), tradeId, step, extra);
    }
  };

  /** What T-072's funding wrote: the pool debited the total, the two liabilities credited. */
  const fund = async (item = ITEM, fee = FEE) =>
    t.db().transaction((tx) =>
      postJournal(tx, {
        idempotencyKey: `charge:fund-${randomUUID()}`,
        description: 'escrow funded',
        tradeId,
        lines: fundingJournalLines(tradeId, {
          currency: 'NGN',
          feeScheduleVersion: 'test-fee-schedule',
          itemAmountMinor: item,
          buyerProtectionFeeMinor: fee,
          totalMinor: item + fee,
        }),
      }),
    );

  const release = (overrides: Partial<Parameters<typeof releaseEscrow>[2]> = {}): Promise<ReleaseResult> =>
    t.db().transaction((tx) => releaseEscrow(tx, deps, { tradeId, ...overrides }));

  const split = (s: DisputeSplit) => release({ settlement: { kind: 'DISPUTE_SPLIT', split: s } });

  /** The reason a settlement was refused, having first asserted that it was. */
  const refusal = (result: ReleaseResult): string => {
    expect(result.outcome).toBe('NOT_RELEASABLE');
    return result.outcome === 'NOT_RELEASABLE' ? result.reason : '';
  };

  const outboxOf = async (eventType: string) => {
    const { rows } = await t
      .app()
      .query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM platform.outbox WHERE event_type = $1 ORDER BY occurred_at`,
        [eventType],
      );
    return rows.map((row) => row.payload);
  };

  beforeEach(async () => {
    buyer = await insertUser(t.app(), { verification_level: 'CONTACT_VERIFIED' });
    seller = await insertUser(t.app(), { verification_level: 'IDENTITY_VERIFIED' });
    tradeId = await insertTrade(t.app(), { buyer, seller });
  });

  describe('a normal release', () => {
    beforeEach(async () => {
      await driveWithFees('COMPLETED');
      await fund();
    });

    it('posts the five lines M8 §4 and T-072 between them describe', async () => {
      const result = await release();
      expect(result.outcome).toBe('SETTLED');

      const { rows } = await t.app().query<{ account_type: string; direction: string; amount: string }>(
        `SELECT a.account_type, e.direction, e.amount_minor AS amount
           FROM ledger.ledger_entries e
           JOIN ledger.ledger_accounts a ON a.id = e.account_id
           JOIN ledger.ledger_journal_entries j ON j.id = e.journal_entry_id
          WHERE j.idempotency_key = $1`,
        [releaseIdempotencyKey(tradeId)],
      );
      // Sorted, because a posting is a set of lines: `ledger_entries.id` is a random uuid and the
      // journal's meaning does not depend on the order they were written in.
      expect(rows.map((r) => `${r.direction} ${r.account_type} ${r.amount}`).sort()).toEqual(
        [
          `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
          `CREDIT USER_PAYABLE ${PROCEEDS}`,
          `CREDIT PLATFORM_FEE_REVENUE ${COMMISSION}`,
          `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
          `CREDIT BUYER_PROTECTION_FEE_REVENUE ${FEE}`,
        ].sort(),
      );
    });

    it('leaves both of the trade’s liabilities at zero, and the pool untouched', async () => {
      await release();

      // The whole point of T-072's second account: after a release the trade owes nothing, on
      // either count, and neither balance had to be derived by subtracting the other.
      expect(await balance(ESCROW())).toBe(0n);
      expect(await balance(FEE_LIABILITY())).toBe(0n);
      expect(await balance(PAYABLE())).toBe(PROCEEDS);
      expect(await balance(COMMISSION_REVENUE)).toBe(COMMISSION);
      expect(await balance(FEE_REVENUE)).toBe(FEE);
      // Release moves nothing in or out of the provider balance; T-073's payout does that.
      expect(await balance(POOL)).toBe(ITEM + FEE);
    });

    it('keeps the trial balance at zero', async () => {
      await release();
      expect(await trialBalance(t.db())).toEqual([
        {
          currency: 'NGN',
          debitsMinor: 2n * (ITEM + FEE),
          creditsMinor: 2n * (ITEM + FEE),
          differenceMinor: 0n,
        },
      ]);
    });

    it('publishes escrow_released once, with the amounts it actually posted', async () => {
      await release();

      const [event, ...rest] = await outboxOf('ledger.payment.escrow_released');
      expect(rest).toHaveLength(0);
      expect(event).toMatchObject({
        tradeId,
        sellerUserId: seller,
        outcome: 'RELEASED',
        currency: 'NGN',
        itemAmountMinor: ITEM.toString(),
        sellerProceedsMinor: PROCEEDS.toString(),
        commissionMinor: COMMISSION.toString(),
        refundToBuyerMinor: '0',
        buyerProtectionFeeMinor: FEE.toString(),
        buyerProtectionFeeTreatment: 'RECOGNISE',
      });
    });

    it('settles once however many times it is asked, and announces it once', async () => {
      const first = await release();
      const second = await release();
      const third = await release();

      expect(first.outcome).toBe('SETTLED');
      expect([second.outcome, third.outcome]).toEqual(['ALREADY_SETTLED', 'ALREADY_SETTLED']);
      expect(await balance(PAYABLE())).toBe(PROCEEDS);
      expect(await outboxOf('ledger.payment.escrow_released')).toHaveLength(1);
    });

    it('settles once when two transactions race it', async () => {
      const results = await Promise.allSettled([release(), release(), release()]);
      const settled = results.filter((r) => r.status === 'fulfilled' && r.value.outcome === 'SETTLED');

      // A loser may fail on the unique index rather than read the row; what must not happen is two
      // postings, two payables or two events.
      expect(settled.length).toBeGreaterThanOrEqual(1);
      expect(await balance(PAYABLE())).toBe(PROCEEDS);
      expect(await balance(ESCROW())).toBe(0n);
      expect(await outboxOf('ledger.payment.escrow_released')).toHaveLength(1);
    });

    it('refuses to settle the same trade a second, different way', async () => {
      await release();
      await expect(
        split({ releaseToSellerMinor: 0n, commissionMinor: 0n, refundToBuyerMinor: ITEM }),
      ).rejects.toThrow(IdempotencyKeyConflictError);
      expect(await balance(PAYABLE())).toBe(PROCEEDS);
    });
  });

  describe('what blocks a release', () => {
    beforeEach(async () => {
      await driveWithFees('COMPLETED');
      await fund();
    });

    it('is blocked by a hold on the trade, and posts nothing', async () => {
      await insertRow(t.app(), 'trade.trade_holds', {
        trade_id: tradeId,
        source: 'RISK',
        reason: 'under review',
        placed_by_actor_type: 'SYSTEM',
      });

      expect(await release()).toEqual({ outcome: 'HELD', holds: ['RISK'] });
      expect(await balance(ESCROW())).toBe(ITEM);
      expect(await balance(PAYABLE())).toBe(0n);
      expect(await outboxOf('ledger.payment.escrow_released')).toHaveLength(0);
    });

    it('releases once the hold is lifted, with nothing lost in between', async () => {
      const hold = await insertRow(t.app(), 'trade.trade_holds', {
        trade_id: tradeId,
        source: 'ADMIN',
        reason: 'manual check',
        placed_by_actor_type: 'STAFF',
      });
      expect((await release()).outcome).toBe('HELD');

      await t.app().query(`UPDATE trade.trade_holds SET released_at = now() WHERE id = $1`, [hold]);

      expect((await release()).outcome).toBe('SETTLED');
      expect(await balance(PAYABLE())).toBe(PROCEEDS);
    });

    it('reports every live hold, and ignores the ones already lifted', async () => {
      for (const source of ['RISK', 'PARK_EXCEPTION']) {
        await insertRow(t.app(), 'trade.trade_holds', {
          trade_id: tradeId,
          source,
          reason: 'held',
          placed_by_actor_type: 'SYSTEM',
        });
      }
      const lifted = await insertRow(t.app(), 'trade.trade_holds', {
        trade_id: tradeId,
        source: 'ADMIN',
        reason: 'held',
        placed_by_actor_type: 'STAFF',
      });
      await t.app().query(`UPDATE trade.trade_holds SET released_at = now() WHERE id = $1`, [lifted]);

      const result = await release();
      expect(result.outcome === 'HELD' && [...result.holds].sort()).toEqual(['PARK_EXCEPTION', 'RISK']);
    });
  });

  describe('what the ledger refuses to call a release', () => {
    it('refuses a trade that was never funded, however complete it looks', async () => {
      await driveWithFees('COMPLETED');

      expect(refusal(await release())).toMatch(/escrow holds 0/);
      expect(await balance(PAYABLE())).toBe(0n);
    });

    it('refuses a trade whose escrow holds something other than the snapshotted item', async () => {
      await driveWithFees('COMPLETED');
      await fund(ITEM - 1n, FEE);

      expect(refusal(await release())).toContain(`not the snapshotted item ${ITEM}`);
    });

    it('refuses a trade whose fee liability has already been discharged', async () => {
      await driveWithFees('COMPLETED');
      await fund(ITEM, 0n);

      expect(refusal(await release())).toContain('protection fee liability holds 0');
    });

    it('refuses a trade that has not completed', async () => {
      await driveWithFees('INSPECTION');
      await fund();

      expect(await release()).toMatchObject({
        outcome: 'NOT_RELEASABLE',
        reason: 'the trade is INSPECTION, not COMPLETED',
      });
      expect(await balance(ESCROW())).toBe(ITEM);
    });

    it('will not split a trade nobody disputed', async () => {
      await driveWithFees('COMPLETED');
      await fund();

      const result = await release({
        settlement: {
          kind: 'DISPUTE_SPLIT',
          split: { releaseToSellerMinor: 0n, commissionMinor: 0n, refundToBuyerMinor: ITEM },
        },
      });
      expect(refusal(result)).toContain('the trade is COMPLETED');
    });

    it('refuses a trade that is not there', async () => {
      expect(await release({ tradeId: randomUUID() })).toEqual({
        outcome: 'NOT_RELEASABLE',
        reason: 'the trade does not exist',
      });
    });

    it('throws on a trade with no fee snapshot rather than inventing one', async () => {
      await expect(release()).rejects.toThrow(ReleaseSnapshotError);
    });
  });

  describe('a dispute resolved with amounts (the T-080 capability)', () => {
    beforeEach(async () => {
      await driveWithFees('DISPUTED');
      await fund();
    });

    it('releases and refunds in ONE journal, and empties the trade’s escrow', async () => {
      const result = await split({
        releaseToSellerMinor: 20_000_000n,
        commissionMinor: COMMISSION,
        refundToBuyerMinor: ITEM - 20_000_000n - COMMISSION,
      });
      expect(result.outcome).toBe('SETTLED');

      expect(await balance(ESCROW())).toBe(0n);
      expect(await balance(FEE_LIABILITY())).toBe(0n);
      expect(await balance(PAYABLE())).toBe(20_000_000n);
      expect(await balance(COMMISSION_REVENUE)).toBe(COMMISSION);
      // The refunded share is back in the pool, where T-075's provider refund will take it from.
      expect(await balance(POOL)).toBe(ITEM + FEE - (ITEM - 20_000_000n - COMMISSION));
      // Q4's default: retained on a partial outcome.
      expect(await balance(FEE_REVENUE)).toBe(FEE);
    });

    it('posts one journal entry, not a release and a refund that could half-commit', async () => {
      await split({
        releaseToSellerMinor: 20_000_000n,
        commissionMinor: COMMISSION,
        refundToBuyerMinor: ITEM - 20_000_000n - COMMISSION,
      });
      const { rows } = await t
        .app()
        .query<{ n: string }>(
          `SELECT count(*) AS n FROM ledger.ledger_journal_entries WHERE idempotency_key = $1`,
          [releaseIdempotencyKey(tradeId)],
        );
      expect(Number(rows[0]?.n)).toBe(1);
    });

    it('gives the protection fee back when the whole item goes back', async () => {
      await split({ releaseToSellerMinor: 0n, commissionMinor: 0n, refundToBuyerMinor: ITEM });

      expect(await balance(FEE_LIABILITY())).toBe(0n);
      expect(await balance(FEE_REVENUE)).toBe(0n);
      expect(await balance(PAYABLE())).toBe(0n);
      // Everything the buyer paid is back in the pool, ready to go out through the provider.
      expect(await balance(POOL)).toBe(0n);
    });

    it('refuses amounts that do not sum to the escrowed item, before writing anything', async () => {
      await expect(
        split({ releaseToSellerMinor: 20_000_000n, commissionMinor: 0n, refundToBuyerMinor: 1n }),
      ).rejects.toThrow(ReleaseSplitError);

      expect(await balance(ESCROW())).toBe(ITEM);
      expect(await outboxOf('ledger.payment.escrow_released')).toHaveLength(0);
    });

    it('announces the split as a split, with the buyer’s share named', async () => {
      await split({
        releaseToSellerMinor: PROCEEDS - 5_000_000n,
        commissionMinor: COMMISSION,
        refundToBuyerMinor: 5_000_000n,
      });

      expect((await outboxOf('ledger.payment.escrow_released'))[0]).toMatchObject({
        outcome: 'DISPUTE_SPLIT',
        sellerProceedsMinor: (PROCEEDS - 5_000_000n).toString(),
        refundToBuyerMinor: '5000000',
        buyerProtectionFeeTreatment: 'RECOGNISE',
      });
    });
  });

  describe('trades with nothing to divide', () => {
    it('releases a trade with no fee and no commission in two lines', async () => {
      await driveWithFees('COMPLETED', ITEM, 0n, 0n);
      await fund(ITEM, 0n);

      expect((await release()).outcome).toBe('SETTLED');
      expect(await balance(PAYABLE())).toBe(ITEM);
      expect(await balance(ESCROW())).toBe(0n);
      expect(await balance(FEE_REVENUE)).toBe(0n);
      expect(await balance(COMMISSION_REVENUE)).toBe(0n);
    });

    it('releases a one-kobo trade', async () => {
      await driveWithFees('COMPLETED', 1n, 0n, 0n);
      await fund(1n, 0n);

      expect((await release()).outcome).toBe('SETTLED');
      expect(await balance(PAYABLE())).toBe(1n);
    });
  });
});
