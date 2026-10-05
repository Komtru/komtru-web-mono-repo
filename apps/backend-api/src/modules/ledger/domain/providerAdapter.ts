// Cannibalized from kumtru/backend-apis/src/modules/ledger/domain/providerAdapter.ts (T-001).
//
// The canonical payment-provider interface — docs/specs/m8-payment-provider-adapter-plan.md §3,
// verbatim. Paystack is the first implementation, not the only one ever (m8 §1), so everything
// downstream of this file — the funding flow (T-072), payouts (T-073), refunds — is written against
// THIS interface and never against Paystack. `infrastructure/providerRegistry.ts` is the one place a
// ProviderCode becomes a concrete adapter, which is what makes provider #2 a new file plus a registry
// entry rather than a grep-and-replace.
//
// No class hierarchy: a provider's adapter is a plain object of plain functions, with credentials
// passed in rather than read from ambient state (m8 §2).
//
// Deliberately NOT here, per m8 §1/§9: Subaccounts, Transaction Splits and Dedicated Virtual Accounts.
// All three settle or collect on Paystack's schedule, which is a hard incompatibility with escrow —
// design conflict C8 replaces the one screen that implied a per-trade account with checkout's
// pay-with-transfer channel. A test guards the whole repository against them.

/** One member per provider integrated. Grows by one per future provider. */
export type ProviderCode = 'PAYSTACK';

export interface InitializeChargeInput {
  /** Minor units (kobo), never a float. */
  amountMinor: number;
  /** ISO 4217, e.g. 'NGN'. */
  currency: string;
  /** OUR reference, unique, the idempotency key — e.g. `trade_fund_${tradeId}`. */
  reference: string;
  customerEmail: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeChargeResult {
  /** The provider's own transaction reference/id. */
  providerReference: string;
  /** Where we redirect/embed the buyer to pay. */
  checkoutUrl: string;
}

export interface TransferRecipientInput {
  accountNumber: string;
  bankCode: string;
  /** From `resolveAccountName` — never trust a user-typed name alone. */
  accountName: string;
}

export interface TransferRecipientResult {
  providerRecipientId: string;
}

export interface InitiateTransferInput {
  providerRecipientId: string;
  amountMinor: number;
  /** OUR reference — e.g. `payout_${payoutRequestId}`. */
  reference: string;
  reason?: string;
}

export interface InitiateTransferResult {
  providerTransferId: string;
  status: 'pending' | 'success' | 'failed';
}

export interface ResolvedAccount {
  accountName: string;
}

export interface Bank {
  name: string;
  code: string;
}

export interface InitiateRefundInput {
  /** The ORIGINAL charge's provider reference — refunds reverse a specific charge, not a person. */
  chargeProviderReference: string;
  /** Full or partial; must not exceed the original charge amount. */
  amountMinor: number;
  /** OUR reference — e.g. `refund_${refundRequestId}` — for our own idempotency bookkeeping. */
  reference: string;
  reason?: string;
}

export interface InitiateRefundResult {
  providerRefundId: string;
  status: 'pending' | 'processing' | 'processed' | 'failed';
}

/**
 * One member per normalized event this module acts on. Ledger-posting code (`domain/journal.ts`,
 * `services/webhookIngest.service.ts`) only ever sees this shape — never a provider's raw payload.
 */
export type NormalizedPaymentEvent =
  | {
      type: 'charge.succeeded';
      reference: string;
      providerReference: string;
      amountMinor: number;
      paidAt: string;
    }
  | { type: 'charge.failed'; reference: string; providerReference: string; reason: string }
  | { type: 'transfer.success'; reference: string; providerTransferId: string }
  | { type: 'transfer.failed'; reference: string; providerTransferId: string; reason: string }
  | { type: 'transfer.reversed'; reference: string; providerTransferId: string }
  | { type: 'refund.pending'; reference: string; providerRefundId: string }
  | { type: 'refund.processing'; reference: string; providerRefundId: string }
  | { type: 'refund.processed'; reference: string; providerRefundId: string; amountMinor: number }
  | { type: 'refund.failed'; reference: string; providerRefundId: string; reason: string };

/**
 * Every method that hits the network returns a Promise and throws ApiError on a non-2xx or malformed
 * response — no adapter method returns `undefined`/`null` for a call that actually failed. `null` is
 * reserved for `parseWebhookEvent`'s "not an event we act on" case specifically.
 *
 * The two synchronous methods are pure, and live in files of their own so a request handler may call
 * them without importing the network client (design §4.4, T-028).
 */
export interface PaymentProviderAdapter {
  readonly code: ProviderCode;
  initializeCharge(input: InitializeChargeInput): Promise<InitializeChargeResult>;
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  parseWebhookEvent(rawBody: Buffer): NormalizedPaymentEvent | null;
  resolveAccountName(accountNumber: string, bankCode: string): Promise<ResolvedAccount>;
  createTransferRecipient(input: TransferRecipientInput): Promise<TransferRecipientResult>;
  initiateTransfer(input: InitiateTransferInput): Promise<InitiateTransferResult>;
  initiateRefund(input: InitiateRefundInput): Promise<InitiateRefundResult>;
  listBanks(): Promise<Bank[]>;
}
