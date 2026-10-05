// GET /v1/config/fees: the current schedule, for V1's fee breakdown, the Park cash-fee notices and
// the read-only fee panel in operations-app (design §6.5). Public, because a buyer needs the fee
// table before they have a session, and because the file is published policy, not a secret.
import { z } from 'zod';
import { defineRoute } from '../../platform/http/route.js';
import { getFeeSchedule } from './fees.js';

/** Money as digit strings, never JSON numbers: the same rule `koboSchema` applies on every boundary. */
const minor = z.string().regex(/^\d{1,19}$/);
const band = z.strictObject({
  rateBps: z.int(),
  minMinor: minor,
  maxMinor: minor.nullable(),
});

export const feeScheduleResponseSchema = z.strictObject({
  version: z.string(),
  currency: z.string(),
  buyerProtectionFee: band.extend({ refundableOnFullRefund: z.boolean() }),
  sellerCommission: band,
  merchantCommission: band,
  parkCashHandlingFee: z.strictObject({ minMinor: minor, maxMinor: minor }),
  payoutFee: z.strictObject({ amountMinor: minor }),
});

export const feesRoute = defineRoute({
  method: 'get',
  path: '/config/fees',
  scope: 'PUBLIC',
  summary: 'The current fee schedule, for display',
  schema: { response: feeScheduleResponseSchema },
  handler: () => {
    const schedule = getFeeSchedule();
    const band = (value: { rateBps: number; minMinor: bigint; maxMinor: bigint | null }) => ({
      rateBps: value.rateBps,
      minMinor: value.minMinor.toString(),
      maxMinor: value.maxMinor === null ? null : value.maxMinor.toString(),
    });
    return Promise.resolve({
      version: schedule.version,
      currency: schedule.currency,
      buyerProtectionFee: {
        ...band(schedule.buyerProtectionFee),
        refundableOnFullRefund: schedule.buyerProtectionFee.refundableOnFullRefund,
      },
      sellerCommission: band(schedule.sellerCommission),
      merchantCommission: band(schedule.merchantCommission),
      parkCashHandlingFee: {
        minMinor: schedule.parkCashHandlingFee.minMinor.toString(),
        maxMinor: schedule.parkCashHandlingFee.maxMinor.toString(),
      },
      payoutFee: { amountMinor: schedule.payoutFee.amountMinor.toString() },
    });
  },
});
