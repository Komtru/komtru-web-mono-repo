// Cannibalized from kumtru/backend-apis/src/modules/ledger/infrastructure/providers/paystack/client.ts
// (T-001), rewritten onto `providerRequest` and with the bank list paginated — see below.
//
// The Paystack wire protocol, and nothing else. No SDK (m8 §5): the handful of REST calls this module
// needs are cheaper to hand-roll than to pull a client library in, and every call site stays explicit
// about what is sent and read back.
//
// This is the ONLY file in the module that touches the network, which is why it is named `client.ts`:
// `komtru/provider-clients` and test/platform/provider-boundaries.test.ts both refuse to let anything
// but `ledger/jobs/` import it (design §4.4, T-028). The two pure halves of the adapter — signature
// verification and payload parsing — live in sibling files a request handler may call directly.
//
// HONEST CAVEAT: there is no live Paystack account in this environment and no call here has ever been
// made against the real API. Request and response shapes follow Paystack's published v1 documentation;
// every test below runs against a local stub server. The first call against a live account is still
// the test that matters.
//
// Deliberately absent, and must stay absent (m8 §1/§9, design C8): `subaccount`, `split_code` and any
// dedicated-virtual-account call. They settle or collect on Paystack's schedule, which cannot hold
// escrowed money. A repository-wide test guards this.
import { ApiError } from '../../../../../platform/errors.js';
import type { Logger } from '../../../../../platform/logger.js';
import {
  providerRequest,
  ProviderHttpError,
  type ProviderHttpMethod,
} from '../../../../../platform/providers/http.js';
import type {
  Bank,
  InitializeChargeInput,
  InitializeChargeResult,
  InitiateRefundInput,
  InitiateRefundResult,
  InitiateTransferInput,
  InitiateTransferResult,
  PaymentProviderAdapter,
  ResolvedAccount,
  TransferRecipientInput,
  TransferRecipientResult,
} from '../../../domain/providerAdapter.js';
import { parsePaystackEvent } from './events.js';
import { verifyPaystackSignature } from './signature.js';

export const PAYSTACK_BASE_URL = 'https://api.paystack.co';
/** 100 banks a page against a Nigerian list of a few hundred; the cap is a provider-bug stop, not a limit. */
export const BANK_PAGE_SIZE = 100;
export const MAX_BANK_PAGES = 20;

export interface PaystackClientOptions {
  logger: Logger;
  /** Absent in an environment with no Paystack credentials; every call then fails closed. */
  secretKey?: string;
  baseUrl?: string;
  /** Passed through to providerRequest; tests shorten them. */
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
}

const unavailable = (detail: string): ApiError =>
  new ApiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The payment provider is unavailable', detail);

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
  meta?: { next?: string | null };
}

interface CallSpec {
  /** Stable name for the logs; the path carries the ids. */
  operation: string;
  method: ProviderHttpMethod;
  path: string;
  body?: unknown;
  /**
   * Whether a repeat is safe. Every POST here except none is `false`: a retried `/transfer` or
   * `/refund` that timed out after the provider accepted it pays twice. The queue's backoff is the
   * real retry, and it re-enters through code that can check what already happened.
   */
  idempotent?: boolean;
}

/**
 * One wrapper for every Paystack call.
 *
 * Paystack answers every endpoint with `{ status, message, data }` and uses `status: false` for a
 * business-level refusal even on a 200 — an unresolvable account number, a disabled integration. Both
 * that and a non-2xx become an `ApiError` here, so no call site has to remember to check twice.
 *
 * The provider's `message` is echoed into the error's `detail` and never into its `title`: `detail` is
 * for the operator reading the log, and Paystack's messages describe the request, not the key. The key
 * itself only ever appears in a header providerRequest does not log.
 */
async function call<T>(options: PaystackClientOptions, spec: CallSpec): Promise<PaystackEnvelope<T>> {
  const { logger, secretKey, baseUrl = PAYSTACK_BASE_URL } = options;
  if (!secretKey) throw unavailable(`paystack ${spec.operation}: PAYSTACK_SECRET_KEY is not set`);

  try {
    const response = await providerRequest<PaystackEnvelope<T>>(logger, {
      provider: 'paystack',
      operation: spec.operation,
      method: spec.method,
      url: `${baseUrl}${spec.path}`,
      headers: { authorization: `Bearer ${secretKey}` },
      idempotent: spec.idempotent ?? false,
      ...(spec.body === undefined ? {} : { body: spec.body }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      ...(options.backoffMs === undefined ? {} : { backoffMs: options.backoffMs }),
    });
    const envelope = response.body;
    if (envelope.status !== true) {
      throw new ApiError(
        502,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'The payment provider refused the request',
        `paystack ${spec.operation}: ${envelope.message ?? 'no status in the response envelope'}`,
      );
    }
    return envelope;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const status = error instanceof ProviderHttpError ? error.status : undefined;
    throw new ApiError(
      502,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'The payment provider could not be reached',
      `paystack ${spec.operation}${status === undefined ? '' : `: HTTP ${String(status)}`}`,
    );
  }
}

/** `data` is absent on a response that claimed success; that is a malformed answer, not an empty one. */
async function data<T>(options: PaystackClientOptions, spec: CallSpec): Promise<T> {
  const envelope = await call<T>(options, spec);
  if (envelope.data === undefined) {
    throw new ApiError(
      502,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'The payment provider returned no data',
      `paystack ${spec.operation}`,
    );
  }
  return envelope.data;
}

interface InitializeTransactionResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export const initializeCharge = async (
  options: PaystackClientOptions,
  input: InitializeChargeInput,
): Promise<InitializeChargeResult> => {
  const response = await data<InitializeTransactionResponse>(options, {
    operation: 'charge.initialize',
    method: 'POST',
    path: '/transaction/initialize',
    body: {
      email: input.customerEmail,
      amount: input.amountMinor,
      currency: input.currency,
      // Always OUR key, never left for Paystack to generate (m8 §5).
      reference: input.reference,
      metadata: input.metadata ?? {},
    },
  });

  return {
    // Paystack echoes back the reference we supplied; it is what every later verify and refund
    // addresses this charge by, so a charge has exactly one identity end to end.
    providerReference: response.reference,
    checkoutUrl: response.authorization_url,
  };
};

export interface VerifiedCharge {
  reference: string;
  status: string;
  amountMinor: number;
  paidAt: string | null;
}

interface VerifyTransactionResponse {
  reference: string;
  status: string;
  amount: number;
  paid_at: string | null;
}

/**
 * The defence-in-depth re-check T-072's ingest job runs before crediting anything: a webhook's amount
 * and status are never trusted on their own (m8 §5/§7).
 *
 * Deliberately not a `PaymentProviderAdapter` method. The interface's members are the cross-module
 * contract (m8 §3), and re-verification only ever happens from inside this module, off a webhook whose
 * route already pins the provider — `POST /webhooks/paystack` can only mean PAYSTACK.
 */
export const verifyCharge = async (
  options: PaystackClientOptions,
  reference: string,
): Promise<VerifiedCharge> => {
  const response = await data<VerifyTransactionResponse>(options, {
    operation: 'charge.verify',
    method: 'GET',
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
    idempotent: true,
  });

  return {
    reference: response.reference,
    status: response.status,
    amountMinor: response.amount,
    paidAt: response.paid_at,
  };
};

interface ResolveAccountResponse {
  account_number: string;
  account_name: string;
}

export const resolveAccountName = async (
  options: PaystackClientOptions,
  accountNumber: string,
  bankCode: string,
): Promise<ResolvedAccount> => {
  const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
  const response = await data<ResolveAccountResponse>(options, {
    operation: 'bank.resolve',
    method: 'GET',
    // The account number is a query VALUE, and providerRequest redacts every query value before
    // logging — which is why it goes here rather than into the path.
    path: `/bank/resolve?${query.toString()}`,
    idempotent: true,
  });

  return { accountName: response.account_name };
};

interface PaystackBank {
  name: string;
  code: string;
  active?: boolean;
}

/**
 * Every bank, not the first page of them.
 *
 * The cannibalized client issued one `GET /bank` and returned whatever came back. Paystack pages that
 * endpoint (50 a page by default) and hands back a cursor in `meta.next`, so the bank list silently
 * stopped partway through the alphabet and a seller whose bank fell outside it could not be paid.
 */
export const listBanks = async (options: PaystackClientOptions): Promise<Bank[]> => {
  const banks: Bank[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_BANK_PAGES; page++) {
    const query = new URLSearchParams({
      country: 'nigeria',
      currency: 'NGN',
      perPage: String(BANK_PAGE_SIZE),
      ...(cursor ? { next: cursor } : {}),
    });
    const envelope = await call<PaystackBank[]>(options, {
      operation: 'bank.list',
      method: 'GET',
      path: `/bank?${query.toString()}`,
      idempotent: true,
    });
    // A page with no `data` at all is a malformed answer, not an empty list. Treating it as empty is
    // how a scheduled refresh would overwrite a good cached list with nothing.
    if (!Array.isArray(envelope.data)) {
      throw new ApiError(
        502,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'The payment provider returned no data',
        'paystack bank.list',
      );
    }
    for (const bank of envelope.data) {
      if (bank.active !== false) banks.push({ name: bank.name, code: bank.code });
    }
    cursor = envelope.meta?.next ?? undefined;
    if (!cursor) break;
  }

  return banks;
};

interface CreateTransferRecipientResponse {
  recipient_code: string;
}

export const createTransferRecipient = async (
  options: PaystackClientOptions,
  input: TransferRecipientInput,
): Promise<TransferRecipientResult> => {
  const response = await data<CreateTransferRecipientResponse>(options, {
    operation: 'transfer-recipient.create',
    method: 'POST',
    path: '/transferrecipient',
    body: {
      type: 'nuban',
      name: input.accountName,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: 'NGN',
    },
  });

  return { providerRecipientId: response.recipient_code };
};

interface InitiateTransferResponse {
  transfer_code: string;
  status: string;
}

/** Paystack's vocabulary, narrowed to what this module models (m8 §3). */
const mapTransferStatus = (status: string): InitiateTransferResult['status'] => {
  if (status === 'success') return 'success';
  if (status === 'failed' || status === 'reversed') return 'failed';
  // 'pending', 'otp' (which should not occur once OTP is disabled on the integration), and anything
  // unrecognised: still in flight. Guessing success or failure here is how a payout gets double-posted.
  return 'pending';
};

/**
 * `source: 'balance'`.
 *
 * RUNBOOK PREREQUISITE, not application code: OTP must be disabled on the Paystack integration
 * (`POST /transfer/disable_otp` + `/disable_otp_finalize`) before any transfer succeeds. That is a
 * one-time dashboard/API setup action (m8 §5).
 */
export const initiateTransfer = async (
  options: PaystackClientOptions,
  input: InitiateTransferInput,
): Promise<InitiateTransferResult> => {
  const response = await data<InitiateTransferResponse>(options, {
    operation: 'transfer.initiate',
    method: 'POST',
    path: '/transfer',
    body: {
      source: 'balance',
      amount: input.amountMinor,
      recipient: input.providerRecipientId,
      reference: input.reference,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    },
  });

  return { providerTransferId: response.transfer_code, status: mapTransferStatus(response.status) };
};

interface CreateRefundResponse {
  id: number | string;
  status: string;
}

const mapRefundStatus = (status: string): InitiateRefundResult['status'] => {
  if (status === 'processing') return 'processing';
  if (status === 'processed' || status === 'success') return 'processed';
  if (status === 'failed') return 'failed';
  return 'pending';
};

/**
 * `transaction` is the ORIGINAL charge's reference, resolved server-side from the trade's funding
 * record — never accepted as raw input from a client (m8 §5/§7). `amount` is always sent explicitly:
 * the interface requires one, and the caller decides full-versus-partial by what it passes.
 *
 * Paystack does not refund its own processing fee, so the ledger must treat that fee as absorbed by
 * the platform on every refunded trade rather than recovered (m8 §5).
 */
export const initiateRefund = async (
  options: PaystackClientOptions,
  input: InitiateRefundInput,
): Promise<InitiateRefundResult> => {
  const response = await data<CreateRefundResponse>(options, {
    operation: 'refund.initiate',
    method: 'POST',
    path: '/refund',
    body: {
      transaction: input.chargeProviderReference,
      amount: input.amountMinor,
      ...(input.reason === undefined ? {} : { merchant_note: input.reason }),
    },
  });

  return { providerRefundId: String(response.id), status: mapRefundStatus(response.status) };
};

/**
 * The assembled adapter — the one thing `jobs/providers.ts` hands to the registry.
 *
 * Credentials are a parameter, not ambient state (m8 §2), so a second Paystack account or a second
 * provider is another call to this function rather than a refactor.
 */
export const createPaystackAdapter = (options: PaystackClientOptions): PaymentProviderAdapter => ({
  code: 'PAYSTACK',
  initializeCharge: (input) => initializeCharge(options, input),
  verifyWebhookSignature: (rawBody, signatureHeader) =>
    verifyPaystackSignature(options.secretKey, rawBody, signatureHeader),
  parseWebhookEvent: (rawBody) => parsePaystackEvent(rawBody),
  resolveAccountName: (accountNumber, bankCode) => resolveAccountName(options, accountNumber, bankCode),
  createTransferRecipient: (input) => createTransferRecipient(options, input),
  initiateTransfer: (input) => initiateTransfer(options, input),
  initiateRefund: (input) => initiateRefund(options, input),
  listBanks: () => listBanks(options),
});
