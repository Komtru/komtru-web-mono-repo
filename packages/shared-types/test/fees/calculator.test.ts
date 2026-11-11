import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  computeTradeFees,
  feeSnapshotSchema,
  snapshotFees,
  snapshotParkCashFee,
  snapshotPayoutFee,
  type TradeFees,
} from '../../src/fees/calculator.js';
import { parseFeeSchedule, type FeeBand, type FeeSchedule } from '../../src/fees/schema.js';

const committed = parseFeeSchedule(
  parse(readFileSync(resolve(import.meta.dirname, '../../../../config/fees.yaml'), 'utf8')),
);

const withBands = (patch: {
  buyerProtection?: Partial<FeeBand>;
  seller?: Partial<FeeBand>;
  merchant?: Partial<FeeBand>;
}): FeeSchedule => ({
  ...committed,
  buyerProtectionFee: { ...committed.buyerProtectionFee, ...patch.buyerProtection },
  sellerCommission: { ...committed.sellerCommission, ...patch.seller },
  merchantCommission: { ...committed.merchantCommission, ...patch.merchant },
});

describe('computeTradeFees', () => {
  it('adds the buyer protection fee on top and leaves the seller whole', () => {
    expect(computeTradeFees(5_000_000n, 'CASUAL', committed)).toEqual({
      itemMinor: 5_000_000n,
      buyerProtectionFeeMinor: 75_000n,
      buyerTotalMinor: 5_075_000n,
      commissionMinor: 0n,
      sellerProceedsMinor: 5_000_000n,
      platformRevenueMinor: 75_000n,
    });
  });

  it.each([
    [100n, 2n], // 1.50 kobo exactly: half up
    [300n, 5n], // 4.50 kobo exactly: half up
    [99n, 1n], // 1.485: down
    [101n, 2n], // 1.515: up
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
    const schedule = withBands({
      buyerProtection: { rateBps: 150, minMinor: 10_000n, maxMinor: 50_000n },
    });
    expect(computeTradeFees(0n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(10_000n);
    expect(computeTradeFees(666_666n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(10_000n);
    expect(computeTradeFees(666_667n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(10_000n);
    expect(computeTradeFees(666_700n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(10_001n);
    expect(computeTradeFees(3_333_333n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(50_000n);
    expect(computeTradeFees(100_000_000n, 'CASUAL', schedule).buyerProtectionFeeMinor).toBe(50_000n);
  });

  it('refuses a commission minimum the item price cannot cover, naming the key', () => {
    const schedule = withBands({ seller: { rateBps: 0, minMinor: 100n, maxMinor: null } });
    expect(() => computeTradeFees(50n, 'CASUAL', schedule)).toThrow(/seller_commission\.min_minor/);
    expect(() => computeTradeFees(100n, 'CASUAL', schedule)).not.toThrow();
  });

  it('refuses an item price that is not non-negative integer kobo', () => {
    expect(() => computeTradeFees(-1n, 'CASUAL', committed)).toThrow(RangeError);
    expect(() => computeTradeFees(1.5 as unknown as bigint, 'CASUAL', committed)).toThrow(TypeError);
    expect(() => computeTradeFees(100 as unknown as bigint, 'CASUAL', committed)).toThrow(TypeError);
  });

  it('never charges the park cash handling fee or the payout fee on a trade', () => {
    const fees = computeTradeFees(5_000_000n, 'CASUAL', committed);
    expect(Object.values(fees)).not.toContain(30_000n);
    expect(Object.values(fees)).not.toContain(50_000n);
    expect(fees.buyerTotalMinor).toBe(5_075_000n);
  });
});

/** A schedule whose every band is arbitrary but internally valid (min <= max). */
const arbitraryBand = fc
  .record({
    rateBps: fc.integer({ min: 0, max: 10_000 }),
    minMinor: fc.bigInt({ min: 0n, max: 1_000_000n }),
    headroom: fc.option(fc.bigInt({ min: 0n, max: 1_000_000n }), { nil: null }),
  })
  .map(({ rateBps, minMinor, headroom }) => ({
    rateBps,
    minMinor,
    maxMinor: headroom === null ? null : minMinor + headroom,
  }));

const arbitrarySchedule = fc
  .record({ buyerProtection: arbitraryBand, seller: arbitraryBand, merchant: arbitraryBand })
  .map(withBands);

const sellerKind = fc.constantFrom('CASUAL' as const, 'MERCHANT' as const);

/** Item prices from the floor the commission minimum needs, so the unsatisfiable case is excluded. */
const computable = fc
  .tuple(arbitrarySchedule, sellerKind, fc.bigInt({ min: 0n, max: 10n ** 14n }))
  .map(([schedule, kind, extra]) => {
    const band = kind === 'CASUAL' ? schedule.sellerCommission : schedule.merchantCommission;
    return [schedule, kind, band.minMinor + extra] as const;
  });

describe('computeTradeFees properties', () => {
  it('always has the total equal the parts', () => {
    fc.assert(
      fc.property(computable, ([schedule, kind, itemMinor]) => {
        const f = computeTradeFees(itemMinor, kind, schedule);
        expect(f.buyerTotalMinor).toBe(f.itemMinor + f.buyerProtectionFeeMinor);
        expect(f.itemMinor).toBe(f.sellerProceedsMinor + f.commissionMinor);
        expect(f.platformRevenueMinor).toBe(f.buyerProtectionFeeMinor + f.commissionMinor);
        expect(f.buyerTotalMinor).toBe(f.sellerProceedsMinor + f.platformRevenueMinor);
      }),
    );
  });

  it('never produces anything but a whole number of kobo', () => {
    fc.assert(
      fc.property(computable, ([schedule, kind, itemMinor]) => {
        const f = computeTradeFees(itemMinor, kind, schedule);
        for (const [key, value] of Object.entries(f)) {
          expect(typeof value, key).toBe('bigint');
          // A float would show a '.' or an exponent; a bigint never can.
          expect(String(value), key).toMatch(/^-?\d+$/);
        }
      }),
    );
  });

  it('always holds the minimum and the cap', () => {
    fc.assert(
      fc.property(computable, ([schedule, kind, itemMinor]) => {
        const f = computeTradeFees(itemMinor, kind, schedule);
        const commission = kind === 'CASUAL' ? schedule.sellerCommission : schedule.merchantCommission;
        for (const [band, charged] of [
          [schedule.buyerProtectionFee, f.buyerProtectionFeeMinor],
          [commission, f.commissionMinor],
        ] as const) {
          expect(charged >= band.minMinor).toBe(true);
          if (band.maxMinor !== null) expect(charged <= band.maxMinor).toBe(true);
        }
      }),
    );
  });

  it('never pays a seller a negative amount or charges a buyer less than the item', () => {
    fc.assert(
      fc.property(computable, ([schedule, kind, itemMinor]) => {
        const f: TradeFees = computeTradeFees(itemMinor, kind, schedule);
        expect(f.sellerProceedsMinor >= 0n).toBe(true);
        expect(f.buyerTotalMinor >= f.itemMinor).toBe(true);
        expect(f.platformRevenueMinor >= 0n).toBe(true);
      }),
    );
  });
});

const AT = new Date('2026-10-05T09:00:00.000Z');

describe('snapshotFees', () => {
  it('carries the version, the amounts and the terms they came from', () => {
    expect(snapshotFees(5_000_000n, 'CASUAL', committed, AT)).toEqual({
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

  it('records which commission band a merchant was charged under', () => {
    const schedule = withBands({ seller: { rateBps: 100 }, merchant: { rateBps: 250 } });
    const snapshot = snapshotFees(1_000_000n, 'MERCHANT', schedule, AT);
    expect(snapshot.sellerKind).toBe('MERCHANT');
    expect(snapshot.terms.commissionBps).toBe(250);
    expect(snapshot.amounts.commissionMinor).toBe('25000');
  });

  it('survives JSON without losing a kobo', () => {
    const snapshot = snapshotFees(9_007_199_254_740_993n, 'MERCHANT', committed, AT);
    expect(snapshot.amounts.itemMinor).toBe('9007199254740993');
    expect(feeSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it('rejects a snapshot whose amounts are not whole kobo strings', () => {
    const snapshot = snapshotFees(5_000_000n, 'CASUAL', committed, AT);
    const broken = { ...snapshot, amounts: { ...snapshot.amounts, itemMinor: '5000000.5' } };
    expect(feeSnapshotSchema.safeParse(broken).success).toBe(false);
  });

  it('agrees with computeTradeFees for every input', () => {
    fc.assert(
      fc.property(computable, ([schedule, kind, itemMinor]) => {
        const fees = computeTradeFees(itemMinor, kind, schedule);
        const { amounts } = snapshotFees(itemMinor, kind, schedule, AT);
        for (const [key, value] of Object.entries(fees)) {
          expect(amounts[key as keyof typeof amounts], key).toBe((value as bigint).toString());
        }
      }),
    );
  });

  it('is unaffected by a later edit to the schedule it came from', () => {
    const snapshot = snapshotFees(5_000_000n, 'CASUAL', committed, AT);
    const changed = withBands({ buyerProtection: { rateBps: 900 } });
    expect(snapshotFees(5_000_000n, 'CASUAL', changed, AT).amounts.buyerProtectionFeeMinor).toBe('450000');
    expect(snapshot.amounts.buyerProtectionFeeMinor).toBe('75000');
  });

  it('defaults takenAt to now', () => {
    const before = Date.now();
    const takenAt = Date.parse(snapshotFees(100n, 'CASUAL', committed).takenAt);
    expect(takenAt).toBeGreaterThanOrEqual(before);
    expect(takenAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('snapshotParkCashFee', () => {
  it('snapshots the range as display-only amounts', () => {
    expect(snapshotParkCashFee(committed, AT)).toEqual({
      version: '2026-10-05.1',
      currency: 'NGN',
      takenAt: '2026-10-05T09:00:00.000Z',
      minMinor: '30000',
      maxMinor: '50000',
    });
  });
});

describe('snapshotPayoutFee (T-073)', () => {
  it('freezes the per-withdrawal fee with the schedule version it came from', () => {
    expect(snapshotPayoutFee(committed, AT)).toEqual({
      version: '2026-10-05.1',
      currency: 'NGN',
      takenAt: '2026-10-05T09:00:00.000Z',
      amountMinor: 0n,
    });
    const charged = { ...committed, payoutFee: { amountMinor: 2_500n } };
    expect(snapshotPayoutFee(charged, AT).amountMinor).toBe(2_500n);
  });
});
