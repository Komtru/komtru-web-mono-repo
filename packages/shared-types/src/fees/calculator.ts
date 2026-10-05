// The one calculator (design §6.5). Pure, integer-only, half up to the kobo: the backend posts from
// it and every frontend displays what the API returns rather than recomputing a total of its own.
import { z } from 'zod';
import { currencySchema, type Currency } from '../enums.js';
import { applyBps, koboJsonSchema, type Kobo } from '../money.js';
import { sellerKindSchema, type FeeBand, type FeeSchedule, type SellerKind } from './schema.js';

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

/**
 * `applyBps` already rounds half up to the kobo in integers; this adds the band's floor and ceiling.
 * The schema guarantees `minMinor <= maxMinor`, so the order of the two clamps cannot matter.
 */
const charge = (amount: Kobo, band: FeeBand): Kobo => {
  const raw = applyBps(amount, BigInt(band.rateBps));
  const floored = raw < band.minMinor ? band.minMinor : raw;
  return band.maxMinor !== null && floored > band.maxMinor ? band.maxMinor : floored;
};

const commissionBand = (sellerKind: SellerKind, schedule: FeeSchedule): [FeeBand, string] =>
  sellerKind === 'MERCHANT'
    ? [schedule.merchantCommission, 'merchant_commission']
    : [schedule.sellerCommission, 'seller_commission'];

/** The Park snapshot gets the same validation on the way back out of JSONB as the trade snapshot. */
export const parkCashFeeSnapshotSchema = z.strictObject({
  version: z.string().min(1),
  currency: currencySchema,
  takenAt: z.iso.datetime(),
  minMinor: koboJsonSchema,
  maxMinor: koboJsonSchema,
});

/**
 * `park_cash_handling_fee` and `payout_fee` are deliberately absent: the Park fee is cash the buyer
 * hands an agent and never enters Komtru's books (C23), and the payout fee is charged per
 * withdrawal, not per trade.
 */
export function computeTradeFees(itemMinor: Kobo, sellerKind: SellerKind, schedule: FeeSchedule): TradeFees {
  if (typeof itemMinor !== 'bigint') {
    throw new TypeError('computeTradeFees takes an item price in kobo as a bigint, never a number');
  }
  // Checked, not trusted: this value arrives from a database column or a request body, it decides
  // which cut the platform takes, and an unrecognised kind would otherwise fall through to the
  // casual band silently — including the day a third seller kind is added.
  sellerKindSchema.parse(sellerKind);
  if (itemMinor < 0n) throw new RangeError('computeTradeFees takes a non-negative item price');

  const buyerProtectionFeeMinor = charge(itemMinor, schedule.buyerProtectionFee);
  const [band, key] = commissionBand(sellerKind, schedule);
  const commissionMinor = charge(itemMinor, band);
  // A minimum larger than the sale is a configuration that cannot be honoured. Dropping it silently
  // would break the minimum; honouring it would pay the seller a negative amount. Neither is a
  // result worth returning, so the key that has to change is named instead.
  if (commissionMinor > itemMinor) {
    throw new RangeError(
      `${key}.min_minor exceeds the item price, which would pay the seller a negative amount`,
    );
  }

  return {
    itemMinor,
    buyerProtectionFeeMinor,
    buyerTotalMinor: itemMinor + buyerProtectionFeeMinor,
    commissionMinor,
    sellerProceedsMinor: itemMinor - commissionMinor,
    platformRevenueMinor: buyerProtectionFeeMinor + commissionMinor,
  };
}

/**
 * What a trade, a parcel or a posting stores so that a later edit to config/fees.yaml cannot change
 * its maths (design §6.5). Amounts are decimal digit strings, not JSON numbers: a snapshot is stored
 * as JSONB and crosses the wire, where a number loses kobo past 2^53 — the same rule `koboSchema`
 * applies to every other amount on an API boundary.
 */
export interface FeeSnapshot {
  /** The `version` of config/fees.yaml these amounts came from. */
  version: string;
  currency: Currency;
  /** ISO-8601 instant the snapshot was taken, so an audit can line it up with git history. */
  takenAt: string;
  sellerKind: SellerKind;
  amounts: {
    itemMinor: string;
    buyerProtectionFeeMinor: string;
    buyerTotalMinor: string;
    commissionMinor: string;
    sellerProceedsMinor: string;
    platformRevenueMinor: string;
  };
  /**
   * The terms the amounts were derived under, so a reader can re-derive them without the file.
   * `buyerProtectionRefundableOnFullRefund` is here because Q4's refund treatment has to be the one
   * in force when the trade was accepted, not the one in force when the refund happens.
   */
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

/** One money vocabulary for the whole platform: digits, and inside the BIGINT range (money.ts). */
const wireAmount = koboJsonSchema;

export const feeSnapshotSchema = z
  .strictObject({
    version: z.string().min(1),
    currency: currencySchema,
    takenAt: z.iso.datetime(),
    sellerKind: sellerKindSchema,
    amounts: z.strictObject({
      itemMinor: wireAmount,
      buyerProtectionFeeMinor: wireAmount,
      buyerTotalMinor: wireAmount,
      commissionMinor: wireAmount,
      sellerProceedsMinor: wireAmount,
      platformRevenueMinor: wireAmount,
    }),
    terms: z.strictObject({
      buyerProtectionBps: z.int().min(0).max(10_000),
      buyerProtectionMinMinor: wireAmount,
      buyerProtectionMaxMinor: wireAmount.nullable(),
      buyerProtectionRefundableOnFullRefund: z.boolean(),
      commissionBps: z.int().min(0).max(10_000),
      commissionMinMinor: wireAmount,
      commissionMaxMinor: wireAmount.nullable(),
    }),
  })
  // The ledger posts real money from a snapshot read back out of JSONB, so the schema is the last
  // line of defence against a hand-edited row, a bad backfill or a serialisation bug. Amounts that
  // validate individually but do not add up are exactly the shape such a bug takes.
  .refine((snapshot) => {
    // Every check still runs after an amount failed its own format check, so this must not be the
    // thing that throws: an amount that is not digits is already reported, and cannot be added up.
    if (Object.values(snapshot.amounts).some((value) => !/^\d{1,19}$/.test(value))) return true;
    const at = (key: keyof FeeSnapshot['amounts']) => BigInt(snapshot.amounts[key]);
    return (
      at('buyerTotalMinor') === at('itemMinor') + at('buyerProtectionFeeMinor') &&
      at('itemMinor') === at('sellerProceedsMinor') + at('commissionMinor') &&
      at('platformRevenueMinor') === at('buyerProtectionFeeMinor') + at('commissionMinor')
    );
  }, 'Snapshot amounts do not add up');

/**
 * Turns a stored snapshot's amounts back into `Kobo`. The ledger would otherwise call `BigInt(...)`
 * at every posting site, which is both boilerplate and a place a `Number()` could creep in.
 */
export const decodeSnapshotAmounts = (snapshot: FeeSnapshot): Record<keyof FeeSnapshot['amounts'], Kobo> =>
  Object.fromEntries(Object.entries(snapshot.amounts).map(([key, value]) => [key, BigInt(value)])) as Record<
    keyof FeeSnapshot['amounts'],
    Kobo
  >;

const wire = (amount: Kobo): string => amount.toString();
const wireOrNull = (amount: Kobo | null): string | null => (amount === null ? null : amount.toString());

/** The trade-scoped snapshot: every number a ledger posting or a refund decision later needs. */
export function snapshotFees(
  itemMinor: Kobo,
  sellerKind: SellerKind,
  schedule: FeeSchedule,
  takenAt: Date = new Date(),
): FeeSnapshot {
  if (Number.isNaN(takenAt.getTime())) throw new RangeError('snapshotFees takes a valid takenAt date');
  const fees = computeTradeFees(itemMinor, sellerKind, schedule);
  const [commission] = commissionBand(sellerKind, schedule);
  const protection = schedule.buyerProtectionFee;
  return {
    version: schedule.version,
    currency: schedule.currency,
    takenAt: takenAt.toISOString(),
    sellerKind,
    amounts: {
      itemMinor: wire(fees.itemMinor),
      buyerProtectionFeeMinor: wire(fees.buyerProtectionFeeMinor),
      buyerTotalMinor: wire(fees.buyerTotalMinor),
      commissionMinor: wire(fees.commissionMinor),
      sellerProceedsMinor: wire(fees.sellerProceedsMinor),
      platformRevenueMinor: wire(fees.platformRevenueMinor),
    },
    terms: {
      buyerProtectionBps: protection.rateBps,
      buyerProtectionMinMinor: wire(protection.minMinor),
      buyerProtectionMaxMinor: wireOrNull(protection.maxMinor),
      buyerProtectionRefundableOnFullRefund: protection.refundableOnFullRefund,
      commissionBps: commission.rateBps,
      commissionMinMinor: wire(commission.minMinor),
      commissionMaxMinor: wireOrNull(commission.maxMinor),
    },
  };
}

/** Display-only (C23): a Park parcel records the range it told the buyer to expect in cash. */
export interface ParkCashFeeSnapshot {
  version: string;
  currency: Currency;
  takenAt: string;
  minMinor: string;
  maxMinor: string;
}

export function snapshotParkCashFee(schedule: FeeSchedule, takenAt: Date = new Date()): ParkCashFeeSnapshot {
  return {
    version: schedule.version,
    currency: schedule.currency,
    takenAt: takenAt.toISOString(),
    minMinor: wire(schedule.parkCashHandlingFee.minMinor),
    maxMinor: wire(schedule.parkCashHandlingFee.maxMinor),
  };
}
