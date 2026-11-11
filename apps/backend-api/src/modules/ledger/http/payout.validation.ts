// The payout routes' wire shapes (T-073). Money leaves as digit-string kobo, never a JSON number. An
// account number arrives once, on the add, and never leaves again: every response carries the masked
// form only.
import {
  PAYOUT_ACCOUNT_STATUSES,
  PAYOUT_MODES,
  PAYOUT_STATUSES,
  PAYOUT_TRIGGERS,
  paginatedSchema,
  positiveKoboSchema,
} from '@komtru/shared-types';
import { z } from 'zod';

const kobo = z.string().regex(/^\d{1,19}$/);

export const idParamSchema = z.object({ id: z.uuid().transform((id) => id.toLowerCase()) });

export const addPayoutAccountBodySchema = z.strictObject({
  bankCode: z.string().trim().min(1).max(10),
  /** Ten digits; spaces and dashes a person types are removed by the service. */
  accountNumber: z.string().trim().min(10).max(20),
});

export const payoutAccountViewSchema = z.object({
  id: z.uuid(),
  bankCode: z.string(),
  bankName: z.string().nullable(),
  accountNumberMasked: z.string(),
  accountName: z.string().nullable(),
  status: z.enum(PAYOUT_ACCOUNT_STATUSES),
  isDefault: z.boolean(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  verifiedAt: z.string().nullable(),
});

/** Bounded (an account list is a handful), so not paginated: `accounts`, not `items`. */
export const payoutAccountListSchema = z.object({ accounts: z.array(payoutAccountViewSchema) });

export const bankListSchema = z.object({
  banks: z.array(z.object({ name: z.string(), code: z.string() })),
});

const destinationSchema = z.object({
  id: z.uuid(),
  bankCode: z.string(),
  bankName: z.string().nullable(),
  accountNumberMasked: z.string(),
  accountName: z.string().nullable(),
});

export const payoutPreferenceBodySchema = z.strictObject({ mode: z.enum(PAYOUT_MODES) });

export const payoutPreferenceViewSchema = z.object({
  mode: z.enum(PAYOUT_MODES),
  defaultAccount: destinationSchema.nullable(),
});

export const requestPayoutBodySchema = z.strictObject({
  amountMinor: positiveKoboSchema,
  payoutAccountId: z
    .uuid()
    .transform((id) => id.toLowerCase())
    .optional(),
});

export const payoutViewSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: z.enum(PAYOUT_STATUSES),
  trigger: z.enum(PAYOUT_TRIGGERS),
  currency: z.string(),
  amountMinor: kobo,
  feeMinor: kobo,
  transferAmountMinor: kobo,
  destination: destinationSchema.nullable(),
  sourceTradeId: z.uuid().nullable(),
  failureReason: z.string().nullable(),
  requestedAt: z.string(),
  dispatchedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
});

export const payoutListSchema = paginatedSchema(payoutViewSchema);

export const payoutSummarySchema = z.object({
  currency: z.string(),
  availableMinor: kobo,
  inFlightMinor: kobo,
  payoutFeeMinor: kobo,
  mode: z.enum(PAYOUT_MODES),
  held: z.boolean(),
  defaultAccount: destinationSchema.nullable(),
});
