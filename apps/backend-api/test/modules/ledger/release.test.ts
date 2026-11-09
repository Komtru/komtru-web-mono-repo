// T-074's pure half: what a release is made of, before any of it touches a database.
//
// Every assertion here is about money that has to come out exactly right, so the tests name the
// amounts rather than deriving them — a test that recomputes the thing under test proves nothing.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertBalanced, UnbalancedJournalError } from '../../../src/modules/ledger/domain/journal.js';
import {
  disputeSplitJournalLines,
  escrowRefundLines,
  feeRefundLines,
  feeRecognitionLines,
  feeTreatmentForSplit,
  planSettlement,
  refundableOnFullRefundOf,
  assertSnapshotMatchesColumns,
  releaseAmounts,
  releaseIdempotencyKey,
  releaseJournalLines,
  ReleaseSnapshotError,
  ReleaseSplitError,
  SettlementAmountError,
  type ReleaseAmounts,
  type ReleaseParties,
  type TradeReleaseSnapshot,
} from '../../../src/modules/ledger/domain/release.js';
import { journalIdempotencyKeySchema } from '../../../src/modules/ledger/domain/journal.js';

const TRADE = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a11';
const SELLER = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a22';
const parties: ReleaseParties = { tradeId: TRADE, sellerUserId: SELLER };

const ITEM = 45_000_000n;
const FEE = 675_000n;
const COMMISSION = 900_000n;

/** The `fee_snapshot` JSONB as T-047 writes it, which is the only place Q4's flag survives. */
const storedSnapshot = (refundable = true, item = ITEM, fee = FEE, commission = COMMISSION) => ({
  version: 'test-fee-schedule',
  currency: 'NGN',
  // Fixed, not `new Date()`: two calls a millisecond apart must build the same snapshot.
  takenAt: '2026-11-09T09:00:00.000Z',
  sellerKind: 'CASUAL',
  amounts: {
    itemMinor: item.toString(),
    buyerProtectionFeeMinor: fee.toString(),
    buyerTotalMinor: (item + fee).toString(),
    commissionMinor: commission.toString(),
    sellerProceedsMinor: (item - commission).toString(),
    platformRevenueMinor: (fee + commission).toString(),
  },
  terms: {
    buyerProtectionBps: 100,
    buyerProtectionMinMinor: '0',
    buyerProtectionMaxMinor: null,
    buyerProtectionRefundableOnFullRefund: refundable,
    commissionBps: 20,
    commissionMinMinor: '0',
    commissionMaxMinor: null,
  },
});

const snapshot = (overrides: Partial<TradeReleaseSnapshot> = {}): TradeReleaseSnapshot => ({
  tradeId: TRADE,
  currency: 'NGN',
  feeScheduleVersion: 'test-fee-schedule',
  itemAmountMinor: ITEM,
  buyerProtectionFeeMinor: FEE,
  commissionMinor: COMMISSION,
  sellerProceedsMinor: ITEM - COMMISSION,
  feeSnapshot: storedSnapshot(),
  ...overrides,
});

const amounts = (overrides: Partial<TradeReleaseSnapshot> = {}): ReleaseAmounts =>
  releaseAmounts(snapshot(overrides));

/** One line as `TYPE DIRECTION amount`, so an expectation reads like the journal it describes. */
const asJournal = (lines: { account: { type: string }; direction: string; amountMinor: bigint }[]) =>
  lines.map((line) => `${line.direction} ${line.account.type} ${line.amountMinor}`);

describe('the release idempotency key', () => {
  it('is namespaced by the trade, not by the attempt (T-070)', () => {
    expect(releaseIdempotencyKey(TRADE)).toBe(`trade:${TRADE}:release`);
  });

  it('is a key the journal will accept', () => {
    expect(journalIdempotencyKeySchema.parse(releaseIdempotencyKey(TRADE))).toBeTypeOf('string');
  });

  it('normalises the trade id, so an upper-case uuid is not a second settlement', () => {
    expect(releaseIdempotencyKey(TRADE.toUpperCase())).toBe(releaseIdempotencyKey(TRADE));
  });

  it('refuses something that is not a trade id', () => {
    expect(() => releaseIdempotencyKey('not-a-uuid')).toThrow();
  });
});

describe('the amounts a release is for', () => {
  it('comes straight off the snapshot', () => {
    expect(amounts()).toEqual({
      currency: 'NGN',
      feeScheduleVersion: 'test-fee-schedule',
      itemAmountMinor: ITEM,
      buyerProtectionFeeMinor: FEE,
      commissionMinor: COMMISSION,
      sellerProceedsMinor: ITEM - COMMISSION,
      feeSnapshot: snapshot().feeSnapshot,
    });
  });

  it('refuses a trade with no complete snapshot', () => {
    expect(() => releaseAmounts(snapshot({ feeScheduleVersion: null }))).toThrow(ReleaseSnapshotError);
    expect(() => releaseAmounts(snapshot({ commissionMinor: null }))).toThrow(ReleaseSnapshotError);
  });

  it('refuses a snapshot whose proceeds are not the item minus the commission', () => {
    expect(() => releaseAmounts(snapshot({ sellerProceedsMinor: ITEM }))).toThrow(
      /item amount minus the commission/,
    );
  });

  it('refuses a non-positive item, a negative fee or a negative commission', () => {
    expect(() => releaseAmounts(snapshot({ itemAmountMinor: 0n, sellerProceedsMinor: -COMMISSION }))).toThrow(
      ReleaseSnapshotError,
    );
    expect(() => releaseAmounts(snapshot({ buyerProtectionFeeMinor: -1n }))).toThrow(ReleaseSnapshotError);
    expect(() => releaseAmounts(snapshot({ commissionMinor: -1n, sellerProceedsMinor: ITEM + 1n }))).toThrow(
      ReleaseSnapshotError,
    );
  });

  it('refuses a currency this ledger does not keep', () => {
    expect(() => releaseAmounts(snapshot({ currency: 'USD' }))).toThrow(/USD/);
  });
});

describe('the journal for a normal release', () => {
  it('debits the escrow liability the ITEM, never the buyer total (T-072)', () => {
    const lines = releaseJournalLines(parties, amounts());
    const escrow = lines.filter((line) => line.account.type === 'USER_ESCROW_LIABILITY');

    expect(escrow).toHaveLength(1);
    expect(escrow[0]).toMatchObject({ direction: 'DEBIT', amountMinor: ITEM });
    // And the fee left through its own account, not through this one: the whole posting takes
    // item + fee out of the two liabilities between them, item from here and fee from there.
    expect(lines.filter((l) => l.direction === 'DEBIT').map((l) => [l.account.type, l.amountMinor])).toEqual([
      ['USER_ESCROW_LIABILITY', ITEM],
      ['BUYER_PROTECTION_FEE_LIABILITY', FEE],
    ]);
  });

  it('credits the seller, the commission and the fee, and balances', () => {
    const lines = releaseJournalLines(parties, amounts());

    expect(asJournal(lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT USER_PAYABLE ${ITEM - COMMISSION}`,
      `CREDIT PLATFORM_FEE_REVENUE ${COMMISSION}`,
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT BUYER_PROTECTION_FEE_REVENUE ${FEE}`,
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('scopes the seller payable to the seller and the liabilities to the trade', () => {
    const lines = releaseJournalLines(parties, amounts());
    expect(lines.map((line) => line.account)).toEqual([
      { type: 'USER_ESCROW_LIABILITY', tradeId: TRADE },
      { type: 'USER_PAYABLE', ownerUserId: SELLER },
      { type: 'PLATFORM_FEE_REVENUE' },
      { type: 'BUYER_PROTECTION_FEE_LIABILITY', tradeId: TRADE },
      { type: 'BUYER_PROTECTION_FEE_REVENUE' },
    ]);
  });

  it('recognises the fee against its own liability, not against the escrow liability', () => {
    const lines = releaseJournalLines(parties, amounts());
    const feeLeg = lines.filter((line) => line.amountMinor === FEE);
    expect(asJournal(feeLeg)).toEqual([
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT BUYER_PROTECTION_FEE_REVENUE ${FEE}`,
    ]);
  });

  it('omits the fee legs entirely when the fee is zero: a ledger line is strictly positive', () => {
    const lines = releaseJournalLines(parties, amounts({ buyerProtectionFeeMinor: 0n }));
    expect(asJournal(lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT USER_PAYABLE ${ITEM - COMMISSION}`,
      `CREDIT PLATFORM_FEE_REVENUE ${COMMISSION}`,
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('omits the commission line at the Q14 default of zero', () => {
    const lines = releaseJournalLines(parties, amounts({ commissionMinor: 0n, sellerProceedsMinor: ITEM }));
    expect(asJournal(lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT USER_PAYABLE ${ITEM}`,
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT BUYER_PROTECTION_FEE_REVENUE ${FEE}`,
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('omits the seller line when a commission takes the whole item, and still balances', () => {
    const lines = releaseJournalLines(
      parties,
      amounts({ commissionMinor: ITEM, sellerProceedsMinor: 0n, buyerProtectionFeeMinor: 0n }),
    );
    expect(asJournal(lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT PLATFORM_FEE_REVENUE ${ITEM}`,
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('balances for any snapshot the trade table would accept', () => {
    for (const item of [1n, 7n, 999n, 45_000_000n, 10n ** 15n]) {
      for (const commission of [0n, 1n, item]) {
        for (const fee of [0n, 1n, 123_456n]) {
          const lines = releaseJournalLines(
            parties,
            amounts({
              itemAmountMinor: item,
              commissionMinor: commission,
              sellerProceedsMinor: item - commission,
              buyerProtectionFeeMinor: fee,
            }),
          );
          expect(() => assertBalanced(lines)).not.toThrow();
          const debits = lines
            .filter((l) => l.direction === 'DEBIT')
            .reduce((sum, l) => sum + l.amountMinor, 0n);
          expect(debits).toBe(item + fee);
        }
      }
    }
  });
});

describe('the refund-side line builders (the T-075 seam)', () => {
  it('returns escrowed item money to the pool', () => {
    expect(asJournal(escrowRefundLines(TRADE, ITEM))).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT PLATFORM_ESCROW_POOL ${ITEM}`,
    ]);
  });

  it('returns the protection fee to the pool', () => {
    expect(asJournal(feeRefundLines(TRADE, FEE))).toEqual([
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT PLATFORM_ESCROW_POOL ${FEE}`,
    ]);
  });

  it('has nothing to say about a zero amount', () => {
    expect(escrowRefundLines(TRADE, 0n)).toEqual([]);
    expect(feeRefundLines(TRADE, 0n)).toEqual([]);
    expect(feeRecognitionLines(TRADE, 0n)).toEqual([]);
  });

  it('refuses a negative amount instead of quietly building nothing', () => {
    // These are exported for T-075 to reuse, and "zero means no line" one step away from
    // "negative means no line" is how a refund silently posts half of itself.
    for (const build of [escrowRefundLines, feeRefundLines, feeRecognitionLines]) {
      expect(() => build(TRADE, -1n)).toThrow(SettlementAmountError);
      expect(() => build(TRADE, -FEE)).toThrow(/-675000/);
    }
  });
});

describe('the fee treatment on a dispute split (design §12 Q4)', () => {
  it('refunds the fee only when the whole item goes back and the snapshot allows it', () => {
    expect(feeTreatmentForSplit(amounts(), ITEM)).toBe('REFUND');
  });

  it('retains the fee on a partial outcome, however small the release', () => {
    expect(feeTreatmentForSplit(amounts(), ITEM - 1n)).toBe('RECOGNISE');
    expect(feeTreatmentForSplit(amounts(), 0n)).toBe('RECOGNISE');
  });

  it('honours the treatment frozen on the trade, not the one in force today', () => {
    expect(feeTreatmentForSplit(amounts({ feeSnapshot: storedSnapshot(false) }), ITEM)).toBe('RECOGNISE');
  });

  it('does not even read the stored snapshot unless the whole item is going back', () => {
    // A release and a partial split must not depend on the JSONB being readable: an unreadable one
    // on a trade settled months ago would otherwise make every redelivery of its event throw.
    const unreadable = amounts({ feeSnapshot: { nothing: 'useful' } });
    expect(feeTreatmentForSplit(unreadable, ITEM - 1n)).toBe('RECOGNISE');
    expect(() => releaseJournalLines(parties, unreadable)).not.toThrow();
    expect(() => feeTreatmentForSplit(unreadable, ITEM)).toThrow(ReleaseSnapshotError);
  });
});

describe('the journal for a dispute split (T-080)', () => {
  const split = (releaseToSeller: bigint, commission: bigint, refund: bigint) => ({
    releaseToSellerMinor: releaseToSeller,
    commissionMinor: commission,
    refundToBuyerMinor: refund,
  });

  it('splits the escrowed item between the seller, the platform and the buyer, in one journal', () => {
    const lines = disputeSplitJournalLines(parties, amounts(), split(30_000_000n, COMMISSION, 14_100_000n));

    expect(asJournal(lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT USER_PAYABLE 30000000`,
      `CREDIT PLATFORM_FEE_REVENUE ${COMMISSION}`,
      `CREDIT PLATFORM_ESCROW_POOL 14100000`,
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT BUYER_PROTECTION_FEE_REVENUE ${FEE}`,
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('refuses amounts that do not sum to the escrowed item, before anything is written', () => {
    expect(() => disputeSplitJournalLines(parties, amounts(), split(30_000_000n, 0n, 14_000_000n))).toThrow(
      ReleaseSplitError,
    );
    // The message carries both sides, because "it does not add up" is useless at three in the morning.
    expect(() => disputeSplitJournalLines(parties, amounts(), split(ITEM, 1n, 0n))).toThrow(
      `${ITEM + 1n}, not ${ITEM}`,
    );
  });

  it('refuses a negative share rather than letting a direction carry the sign', () => {
    expect(() => disputeSplitJournalLines(parties, amounts(), split(-1n, 0n, ITEM + 1n))).toThrow(
      ReleaseSplitError,
    );
  });

  it('will not book more commission than the trade froze, sum or no sum', () => {
    // The shares add up perfectly and the whole escrowed item becomes platform revenue. The trade's
    // own commission is the ceiling the snapshot already carries, so a caller bug is a refusal.
    expect(() => disputeSplitJournalLines(parties, amounts(), split(0n, ITEM, 0n))).toThrow(
      ReleaseSplitError,
    );
    expect(() => disputeSplitJournalLines(parties, amounts(), split(0n, ITEM, 0n))).toThrow(
      `commission ${ITEM} is more than the ${COMMISSION} this trade froze`,
    );
  });

  it('allows any commission up to the frozen one', () => {
    for (const commission of [0n, 1n, COMMISSION - 1n, COMMISSION]) {
      const lines = disputeSplitJournalLines(
        parties,
        amounts(),
        split(ITEM - commission - 1n, commission, 1n),
      );
      expect(() => assertBalanced(lines)).not.toThrow();
    }
  });

  it('allows no commission at all on a trade that froze none', () => {
    const free = amounts({ commissionMinor: 0n, sellerProceedsMinor: ITEM });
    expect(() => disputeSplitJournalLines(parties, free, split(0n, 1n, ITEM - 1n))).toThrow(
      ReleaseSplitError,
    );
    expect(() => disputeSplitJournalLines(parties, free, split(ITEM, 0n, 0n))).not.toThrow();
  });

  it('sends the fee back to the pool when the whole item is refunded', () => {
    const lines = disputeSplitJournalLines(parties, amounts(), split(0n, 0n, ITEM));

    expect(asJournal(lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT PLATFORM_ESCROW_POOL ${ITEM}`,
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT PLATFORM_ESCROW_POOL ${FEE}`,
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('lets the caller override the derived treatment, because a human may decide otherwise', () => {
    const lines = disputeSplitJournalLines(parties, amounts(), {
      ...split(0n, 0n, ITEM),
      feeTreatment: 'RECOGNISE',
    });
    expect(asJournal(lines).slice(-2)).toEqual([
      `DEBIT BUYER_PROTECTION_FEE_LIABILITY ${FEE}`,
      `CREDIT BUYER_PROTECTION_FEE_REVENUE ${FEE}`,
    ]);
  });

  it('is the whole release when nothing is refunded, and matches the normal release journal', () => {
    const asSplit = disputeSplitJournalLines(parties, amounts(), split(ITEM - COMMISSION, COMMISSION, 0n));
    expect(asJournal(asSplit)).toEqual(asJournal(releaseJournalLines(parties, amounts())));
  });

  it('discharges the fee liability in full whichever way the item is split', () => {
    for (const [release, refund] of [
      [ITEM - COMMISSION, 0n],
      [ITEM - COMMISSION - 1n, 1n],
      [0n, ITEM],
    ] as const) {
      const commission = release === 0n ? 0n : COMMISSION;
      const lines = disputeSplitJournalLines(parties, amounts(), split(release, commission, refund));
      const feeDebit = lines.filter(
        (line) => line.account.type === 'BUYER_PROTECTION_FEE_LIABILITY' && line.direction === 'DEBIT',
      );
      expect(feeDebit.map((line) => line.amountMinor)).toEqual([FEE]);
      expect(() => assertBalanced(lines)).not.toThrow();
    }
  });

  it('leaves a zero-fee trade with no fee legs at all', () => {
    const lines = disputeSplitJournalLines(
      parties,
      amounts({ buyerProtectionFeeMinor: 0n }),
      split(0n, 0n, ITEM),
    );
    expect(asJournal(lines)).toEqual([
      `DEBIT USER_ESCROW_LIABILITY ${ITEM}`,
      `CREDIT PLATFORM_ESCROW_POOL ${ITEM}`,
    ]);
  });

  it('cannot produce a one-line posting even for a trade worth one kobo', () => {
    const one = amounts({
      itemAmountMinor: 1n,
      commissionMinor: 0n,
      sellerProceedsMinor: 1n,
      buyerProtectionFeeMinor: 0n,
    });
    expect(() => assertBalanced(disputeSplitJournalLines(parties, one, split(1n, 0n, 0n)))).not.toThrow();
    expect(() => assertBalanced([])).toThrow(UnbalancedJournalError);
  });

  it('refuses a seller payable scoped to nobody', () => {
    expect(() => releaseJournalLines({ tradeId: TRADE, sellerUserId: '' }, amounts())).toThrow();
    expect(() => releaseJournalLines({ tradeId: randomUUID(), sellerUserId: 'nope' }, amounts())).toThrow();
  });
});

describe("Q4's treatment out of the stored snapshot", () => {
  it('reads the frozen flag, either way', () => {
    expect(refundableOnFullRefundOf(storedSnapshot(true))).toBe(true);
    expect(refundableOnFullRefundOf(storedSnapshot(false))).toBe(false);
  });

  it('refuses a snapshot it cannot read rather than defaulting to keeping the money', () => {
    expect(() => refundableOnFullRefundOf(null)).toThrow(ReleaseSnapshotError);
    expect(() => refundableOnFullRefundOf({ terms: {} })).toThrow(ReleaseSnapshotError);
    const bent = storedSnapshot();
    bent.amounts.buyerTotalMinor = '1';
    expect(() => refundableOnFullRefundOf(bent)).toThrow(ReleaseSnapshotError);
  });
});

describe('the stored snapshot against the frozen columns', () => {
  it('passes when they agree', () => {
    expect(() => assertSnapshotMatchesColumns(amounts())).not.toThrow();
  });

  it('catches a column and a JSONB that disagree about any of the three amounts', () => {
    const cases: [string, Partial<TradeReleaseSnapshot>][] = [
      ['itemMinor', { feeSnapshot: storedSnapshot(true, ITEM + 1n, FEE, COMMISSION) }],
      ['buyerProtectionFeeMinor', { feeSnapshot: storedSnapshot(true, ITEM, FEE + 1n, COMMISSION) }],
      ['commissionMinor', { feeSnapshot: storedSnapshot(true, ITEM, FEE, COMMISSION + 1n) }],
    ];
    for (const [field, override] of cases) {
      expect(() => assertSnapshotMatchesColumns(amounts(override)), field).toThrow(ReleaseSnapshotError);
    }
  });

  it('catches a snapshot that cannot be read at all', () => {
    expect(() => assertSnapshotMatchesColumns(amounts({ feeSnapshot: null }))).toThrow(ReleaseSnapshotError);
  });
});

describe('planning a settlement', () => {
  it('reports exactly what it posts, for a normal release', () => {
    const planned = planSettlement(parties, amounts(), { kind: 'RELEASE' });
    expect(planned.shares).toEqual({
      sellerProceedsMinor: ITEM - COMMISSION,
      commissionMinor: COMMISSION,
      refundToBuyerMinor: 0n,
      feeTreatment: 'RECOGNISE',
    });
    expect(planned.lines).toEqual(releaseJournalLines(parties, amounts()));
  });

  it('reports exactly what it posts, for a split', () => {
    const split = {
      releaseToSellerMinor: 20_000_000n,
      commissionMinor: COMMISSION,
      refundToBuyerMinor: ITEM - 20_000_000n - COMMISSION,
    };
    const planned = planSettlement(parties, amounts(), { kind: 'DISPUTE_SPLIT', split });

    expect(planned.shares).toEqual({
      sellerProceedsMinor: split.releaseToSellerMinor,
      commissionMinor: split.commissionMinor,
      refundToBuyerMinor: split.refundToBuyerMinor,
      feeTreatment: 'RECOGNISE',
    });
    const credited = planned.lines
      .filter((l) => l.direction === 'CREDIT')
      .reduce((sum, l) => sum + l.amountMinor, 0n);
    expect(credited).toBe(ITEM + FEE);
  });

  it('settles the fee treatment once, so the event and the journal cannot disagree', () => {
    const planned = planSettlement(parties, amounts(), {
      kind: 'DISPUTE_SPLIT',
      split: { releaseToSellerMinor: 0n, commissionMinor: 0n, refundToBuyerMinor: ITEM },
    });
    expect(planned.shares.feeTreatment).toBe('REFUND');
    expect(asJournal(planned.lines).slice(-1)).toEqual([`CREDIT PLATFORM_ESCROW_POOL ${FEE}`]);
  });

  it('throws before producing anything when the split does not sum', () => {
    expect(() =>
      planSettlement(parties, amounts(), {
        kind: 'DISPUTE_SPLIT',
        split: { releaseToSellerMinor: 1n, commissionMinor: 0n, refundToBuyerMinor: 1n },
      }),
    ).toThrow(ReleaseSplitError);
  });
});
