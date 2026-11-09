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
  feeTreatmentForSplit,
  releaseAmounts,
  releaseIdempotencyKey,
  releaseJournalLines,
  ReleaseSnapshotError,
  ReleaseSplitError,
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

const snapshot = (overrides: Partial<TradeReleaseSnapshot> = {}): TradeReleaseSnapshot => ({
  tradeId: TRADE,
  currency: 'NGN',
  feeScheduleVersion: 'test-fee-schedule',
  itemAmountMinor: ITEM,
  buyerProtectionFeeMinor: FEE,
  commissionMinor: COMMISSION,
  sellerProceedsMinor: ITEM - COMMISSION,
  refundableOnFullRefund: true,
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
      refundableOnFullRefund: true,
    });
  });

  it('refuses a trade with no complete snapshot', () => {
    expect(() => releaseAmounts(snapshot({ feeScheduleVersion: null }))).toThrow(ReleaseSnapshotError);
    expect(() => releaseAmounts(snapshot({ commissionMinor: null }))).toThrow(ReleaseSnapshotError);
    expect(() => releaseAmounts(snapshot({ refundableOnFullRefund: null }))).toThrow(ReleaseSnapshotError);
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
    // The buyer total is item + fee; debiting that would overdraw the escrow liability by the fee.
    expect(escrow[0]?.amountMinor).not.toBe(ITEM + FEE);
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
    expect(feeTreatmentForSplit(amounts({ refundableOnFullRefund: false }), ITEM)).toBe('RECOGNISE');
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
