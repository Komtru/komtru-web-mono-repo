// GET /v1/config/fees: the current schedule, for V1's fee breakdown, the Park cash-fee notices and
// the read-only fee panel in operations-app (design §6.5). Public, because a buyer needs the fee
// table before they have a session, and because the file is published policy, not a secret.
import { currencySchema, koboJsonSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { defineRoute } from '../../platform/http/route.js';
import { getFeeSchedule } from './fees.js';

/** Money as digit strings, never JSON numbers: the same rule `koboSchema` applies on every boundary. */
const minor = koboJsonSchema;
const band = z.strictObject({
  rateBps: z.int().min(0).max(10_000),
  minMinor: minor,
  maxMinor: minor.nullable(),
});

export const feeScheduleResponseSchema = z.strictObject({
  version: z.string(),
  currency: currencySchema,
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
  // Unauthenticated and hit by every buyer before they have a session, so it carries a per-IP
  // budget like any other public route. The body is an in-memory constant that only changes with a
  // deploy, so it is also safe to cache at the edge for a minute.
  rateLimit: { points: 120, durationSeconds: 60, by: ['ip'] },
  schema: { response: feeScheduleResponseSchema },
  handler: ({ res }) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    const schedule = getFeeSchedule();
    const bandJson = (value: { rateBps: number; minMinor: bigint; maxMinor: bigint | null }) => ({
      rateBps: value.rateBps,
      minMinor: value.minMinor.toString(),
      maxMinor: value.maxMinor === null ? null : value.maxMinor.toString(),
    });
    return Promise.resolve({
      version: schedule.version,
      currency: schedule.currency,
      buyerProtectionFee: {
        ...bandJson(schedule.buyerProtectionFee),
        refundableOnFullRefund: schedule.buyerProtectionFee.refundableOnFullRefund,
      },
      sellerCommission: bandJson(schedule.sellerCommission),
      merchantCommission: bandJson(schedule.merchantCommission),
      parkCashHandlingFee: {
        minMinor: schedule.parkCashHandlingFee.minMinor.toString(),
        maxMinor: schedule.parkCashHandlingFee.maxMinor.toString(),
      },
      payoutFee: { amountMinor: schedule.payoutFee.amountMinor.toString() },
    });
  },
});
