// Cannibalized from kumtru/backend-apis/src/modules/ledger/infrastructure/providers/paystack/webhook.ts
// (T-001), with every field coercion replaced by validation — see below.
//
// Pure: no I/O. The webhook route calls it inline; `client.ts` stays importable only from jobs/.
//
// HONEST CAVEAT: no live Paystack account exists in this environment, so the payload shapes follow
// Paystack's published webhook documentation rather than a delivery this code has received. The
// signature SCHEME is the stable contract and is what signature.test.ts exercises end to end; the
// less-documented refund field names should be re-checked against the first real delivery. Because
// this parser validates instead of coercing, a shape that is wrong shows up as a rejected delivery in
// the logs rather than as a silently wrong ledger posting.
import { z } from 'zod';
import { ApiError } from '../../../../../platform/errors.js';
import type { NormalizedPaymentEvent } from '../../../domain/providerAdapter.js';

/**
 * Kobo. Integral and non-negative: the cannibalized parser's `typeof x === 'number' ? x : 0` turned a
 * missing or string amount into a zero-kobo event, which downstream is a charge that succeeded for
 * nothing. A delivery we cannot read is a delivery we refuse, not one we guess at.
 */
const amountMinor = z.number().int().nonnegative();
const reference = z.string().min(1);
/** Paystack sends a refund's `id` as a number and a transfer's `transfer_code` as a string. */
const providerId = z.union([z.string().min(1), z.number().int()]).transform(String);

const envelope = z.object({ event: z.string().min(1), data: z.looseObject({}) });

const chargeSucceeded = z.object({
  reference,
  amount: amountMinor,
  paid_at: z.string().min(1),
});
const chargeFailed = z.object({
  reference,
  gateway_response: z.string().min(1).optional(),
  message: z.string().min(1).nullish(),
});
const transfer = z.object({ reference, transfer_code: providerId });
const transferFailed = transfer.extend({
  reason: z.string().min(1).nullish(),
  message: z.string().min(1).nullish(),
});

/**
 * A refund carries no reference of ours: Paystack's Refund API accepts none, unlike a charge, where we
 * supply `reference` at initialize and Paystack echoes it back. The ORIGINAL charge's reference is what
 * identifies the trade, and it arrives either flat or nested depending on the event. `webhookIngest`
 * (T-072) matches a refund to its row by `providerRefundId`; this reference is how a human reading the
 * log finds the trade.
 */
const refund = z.object({
  id: providerId,
  transaction_reference: reference.optional(),
  reference: reference.optional(),
  transaction: z.looseObject({ reference: reference.optional() }).optional(),
  status: z.string().min(1).optional(),
});
const refundProcessed = refund.extend({ amount: amountMinor });

type Refund = z.output<typeof refund>;

const refundReference = (data: Refund): string =>
  data.transaction_reference ?? data.reference ?? data.transaction?.reference ?? data.id;

/** Names the event and the failing paths; never a value, since a payload carries customer data. */
const reject = (event: string, error: z.ZodError): never => {
  const paths = [...new Set(error.issues.map((issue) => issue.path.join('.') || '(root)'))];
  throw new ApiError(
    400,
    'VALIDATION_FAILED',
    'The webhook payload could not be read',
    `paystack ${event}: ${paths.join(', ')}`,
  );
};

const parse = <T extends z.ZodType>(event: string, schema: T, data: unknown): z.output<T> => {
  const result = schema.safeParse(data);
  return result.success ? result.data : reject(event, result.error);
};

/**
 * One delivery → the shape the ledger acts on (m8 §3).
 *
 * Returns `null` for an event this module does not act on — not an error. Throws `ApiError` 400 for a
 * body that is not a Paystack envelope, or whose data does not match the event it claims to be. The
 * order matters: an unrecognised event never reaches validation, so a new Paystack event type is never
 * reported as a malformed delivery.
 */
export function parsePaystackEvent(rawBody: Buffer): NormalizedPaymentEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The webhook body is not valid JSON');
  }

  const parsedEnvelope = envelope.safeParse(payload);
  if (!parsedEnvelope.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The webhook body is not a Paystack event envelope');
  }
  const { event, data } = parsedEnvelope.data;

  switch (event) {
    case 'charge.success': {
      const charge = parse(event, chargeSucceeded, data);
      return {
        type: 'charge.succeeded',
        reference: charge.reference,
        // The same string deliberately: `/transaction/initialize` echoes back only the reference we
        // supplied, and that is what `/transaction/verify/:reference` and `/refund` address. Using
        // `data.id` here instead would give a charge two identities that never meet.
        providerReference: charge.reference,
        amountMinor: charge.amount,
        paidAt: charge.paid_at,
      };
    }
    case 'charge.failed': {
      const charge = parse(event, chargeFailed, data);
      return {
        type: 'charge.failed',
        reference: charge.reference,
        providerReference: charge.reference,
        reason: charge.gateway_response ?? charge.message ?? 'charge failed',
      };
    }
    case 'transfer.success': {
      const data_ = parse(event, transfer, data);
      return {
        type: 'transfer.success',
        reference: data_.reference,
        providerTransferId: data_.transfer_code,
      };
    }
    case 'transfer.failed': {
      const data_ = parse(event, transferFailed, data);
      return {
        type: 'transfer.failed',
        reference: data_.reference,
        providerTransferId: data_.transfer_code,
        reason: data_.reason ?? data_.message ?? 'transfer failed',
      };
    }
    case 'transfer.reversed': {
      const data_ = parse(event, transfer, data);
      return {
        type: 'transfer.reversed',
        reference: data_.reference,
        providerTransferId: data_.transfer_code,
      };
    }
    case 'refund.pending': {
      const data_ = parse(event, refund, data);
      return { type: 'refund.pending', reference: refundReference(data_), providerRefundId: data_.id };
    }
    case 'refund.processing': {
      const data_ = parse(event, refund, data);
      return { type: 'refund.processing', reference: refundReference(data_), providerRefundId: data_.id };
    }
    case 'refund.processed': {
      const data_ = parse(event, refundProcessed, data);
      return {
        type: 'refund.processed',
        reference: refundReference(data_),
        providerRefundId: data_.id,
        amountMinor: data_.amount,
      };
    }
    /**
     * Paystack has already credited the refund amount back to the PLATFORM's balance, and the buyer was
     * never reached (m8 §3). The money never left the platform's control in this model, so T-072's
     * ingest marks the refund row FAILED for ops and posts no balance movement — inventing one here
     * would be the double-count m8 warns about.
     */
    case 'refund.failed': {
      const data_ = parse(event, refund, data);
      return {
        type: 'refund.failed',
        reference: refundReference(data_),
        providerRefundId: data_.id,
        reason: data_.status ?? 'refund failed',
      };
    }
    default:
      return null;
  }
}
