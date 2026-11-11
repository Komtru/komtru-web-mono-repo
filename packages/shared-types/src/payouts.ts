// Getting a seller paid out (T-073): the vocabulary the backend's payout tables and the payout screens
// (Seller-6, AB5, AB6, WF1, PR1) share. The backend's schema declares the same lists; a test pins them.
import { z } from 'zod';

/** A payout account's lifecycle: added, then verified with the provider or failed; removed is final. */
export const PAYOUT_ACCOUNT_STATUSES = ['PENDING_VERIFICATION', 'VERIFIED', 'FAILED', 'DISABLED'] as const;

/** How a seller wants to be paid. Weekly is Monday and monthly the 1st, Africa/Lagos. */
export const PAYOUT_MODES = [
  'MANUAL',
  'AUTO_IMMEDIATE',
  'AUTO_DAILY',
  'AUTO_WEEKLY',
  'AUTO_MONTHLY',
] as const;

/** What asked for a payout: the seller's withdraw, a release paid out at once, or the daily sweep. */
export const PAYOUT_TRIGGERS = ['MANUAL', 'AUTO_IMMEDIATE', 'AUTO_SWEEP'] as const;

/**
 * A payout's lifecycle. REQUESTED and PROCESSING are on their way; SUCCEEDED is in the bank; FAILED and
 * REVERSED mean the whole amount, fee included, is back in the available balance (WF1); NEEDS_REVIEW is
 * the provider's answer not matching what was sent, held for the team.
 */
export const PAYOUT_STATUSES = [
  'REQUESTED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'REVERSED',
  'NEEDS_REVIEW',
] as const;

export const payoutAccountStatusSchema = z.enum(PAYOUT_ACCOUNT_STATUSES);
export const payoutModeSchema = z.enum(PAYOUT_MODES);
export const payoutTriggerSchema = z.enum(PAYOUT_TRIGGERS);
export const payoutStatusSchema = z.enum(PAYOUT_STATUSES);

export type PayoutAccountStatus = z.infer<typeof payoutAccountStatusSchema>;
export type PayoutMode = z.infer<typeof payoutModeSchema>;
export type PayoutTrigger = z.infer<typeof payoutTriggerSchema>;
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;
