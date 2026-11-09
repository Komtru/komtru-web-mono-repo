// Cannibalized from kumtru/backend-apis/src/modules/ledger/infrastructure/providers/paystack/client.ts
// (T-001), rewritten onto `providerRequest`, with the bank list actually paginated and every response
// validated — see below.
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
// every test below runs against a local stub server. The first call against a live account is still the
// test that matters, and the two things to confirm first are the bank list's `use_cursor` paging and
// the exact field names on the refund responses.
//
// Three request parameters and one endpoint family are deliberately absent and must stay absent — the
// ones m8 §1/§9 forbids, because they settle or collect on Paystack's schedule and cannot hold escrowed
// money (design C8). The specs name them; test/support/forbidden-primitives.ts fails the build if any
// of them appears anywhere in source.
import { z } from 'zod';
import { ApiError } from '../../../../../platform/errors.js';
import type { Logger } from '../../../../../platform/logger.js';
import {
  providerRequest,
  ProviderHttpError,
  ProviderUnavailableError,
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
import { ChargeNotFoundError } from '../../../domain/funding.js';
import { parsePaystackEvent } from './events.js';
import { verifyPaystackSignature } from './signature.js';

export const PAYSTACK_BASE_URL = 'https://api.paystack.co';
/** 100 banks a page against a Nigerian list of several hundred. */
export const BANK_PAGE_SIZE = 100;
/** A stop for a provider that keeps offering a next page, not an expected limit. */
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

const unreadable = (operation: string, paths: string[]): ApiError =>
  new ApiError(
    502,
    'PAYMENT_PROVIDER_UNAVAILABLE',
    'The payment provider returned an unreadable response',
    `paystack ${operation}: ${paths.join(', ')}`,
  );

interface PaystackEnvelope {
  status?: boolean;
  message?: string;
  data?: unknown;
  /** Present on the cursor-paginated endpoints; `next` carries the following page's cursor. */
  meta?: { next?: string | null };
}

interface CallSpec {
  /** Stable name for the logs; the path carries the ids. */
  operation: string;
  method: ProviderHttpMethod;
  path: string;
  body?: unknown;
  /**
   * Whether a repeat is safe. Every POST here is `false`: a retried `/transfer` or `/refund` that timed
   * out after the provider accepted it pays twice. The queue's backoff is the real retry, and it
   * re-enters through code that can check what already happened.
   */
  idempotent?: boolean;
  /**
   * Turns one specific refusal into an error of the caller's own, before the generic translation.
   * Given the HTTP status (200 for an envelope with `status: false`) and the provider's body.
   */
  recognise?: (status: number, body: unknown) => Error | undefined;
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
async function call(options: PaystackClientOptions, spec: CallSpec): Promise<PaystackEnvelope> {
  const { logger, secretKey, baseUrl = PAYSTACK_BASE_URL } = options;
  if (!secretKey) throw unavailable(`paystack ${spec.operation}: PAYSTACK_SECRET_KEY is not set`);

  try {
    const response = await providerRequest<PaystackEnvelope>(logger, {
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
      const recognised = spec.recognise?.(200, envelope);
      if (recognised) throw recognised;
      throw new ApiError(
        502,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'The payment provider refused the request',
        `paystack ${spec.operation}: ${envelope.message ?? 'no status in the response envelope'}`,
      );
    }
    return envelope;
  } catch (error) {
    if (error instanceof ApiError || error instanceof ChargeNotFoundError) throw error;
    // Only the provider's own failures are translated. A TypeError from our code here is a bug, and
    // dressing it as a provider outage would hide it behind a retry and point the operator at Paystack.
    if (error instanceof ProviderHttpError) {
      const recognised = spec.recognise?.(error.status, error.body);
      if (recognised) throw recognised;
      throw new ApiError(
        502,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'The payment provider refused the request',
        `paystack ${spec.operation}: HTTP ${String(error.status)}`,
      );
    }
    if (error instanceof ProviderUnavailableError) {
      throw new ApiError(
        502,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'The payment provider could not be reached',
        `paystack ${spec.operation}: ${error.reason}`,
      );
    }
    throw error;
  }
}

/**
 * Validates a response body, naming the failing fields and never their values.
 *
 * `events.ts` validates every webhook field because a missing one there silently became a zero-kobo
 * credit. A response body deserves the same treatment, and `charge.verify` most of all: it is the
 * re-check T-072 runs BEFORE crediting the ledger, so an unchecked cast there would let an undefined
 * amount through the one function whose whole job is not to believe the webhook.
 */
const validate = <S extends z.ZodType>(operation: string, schema: S, body: unknown): z.output<S> => {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw unreadable(operation, [
    ...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)')),
  ]);
};

/** `data` is absent on a response that claimed success; that is a malformed answer, not an empty one. */
async function data<S extends z.ZodType>(
  options: PaystackClientOptions,
  spec: CallSpec,
  schema: S,
): Promise<z.output<S>> {
  const envelope = await call(options, spec);
  if (envelope.data === undefined) {
    throw new ApiError(
      502,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'The payment provider returned no data',
      `paystack ${spec.operation}`,
    );
  }
  return validate(spec.operation, schema, envelope.data);
}

const initializeTransactionResponse = z.object({
  authorization_url: z.url(),
  access_code: z.string().min(1),
  reference: z.string().min(1),
});

export const initializeCharge = async (
  options: PaystackClientOptions,
  input: InitializeChargeInput,
): Promise<InitializeChargeResult> => {
  const response = await data(
    options,
    {
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
    },
    initializeTransactionResponse,
  );

  return {
    // Paystack echoes back the reference we supplied; it is what every later verify and refund
    // addresses this charge by, so a charge has exactly one identity end to end.
    providerReference: response.reference,
    checkoutUrl: response.authorization_url,
  };
};

const mentionsNotFound = (body: unknown): boolean => {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /not\s*found/i.test(message);
};

export interface VerifiedCharge {
  reference: string;
  status: string;
  amountMinor: number;
  /**
   * The currency Paystack actually settled in. Not on `NormalizedPaymentEvent`, which is m8 §3
   * verbatim and carries none — which is exactly why it belongs here: this is the record T-072 checks
   * the webhook against, and an amount without its currency cannot tell NGN 152,250 from USD 152,250.
   */
  currency: string;
  paidAt: string | null;
}

const verifyTransactionResponse = z.object({
  reference: z.string().min(1),
  status: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  paid_at: z.string().min(1).nullable(),
});

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
  const response = await data(
    options,
    {
      operation: 'charge.verify',
      method: 'GET',
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      idempotent: true,
      // Paystack answers an unknown reference with a 400 and "Transaction reference not found".
      // That is an answer about the charge, not a failed call: the attempt records it (AB4).
      recognise: (status, body) =>
        (status === 400 || status === 404 || status === 200) && mentionsNotFound(body)
          ? new ChargeNotFoundError(reference)
          : undefined,
    },
    verifyTransactionResponse,
  );

  return {
    reference: response.reference,
    status: response.status,
    amountMinor: response.amount,
    currency: response.currency,
    paidAt: response.paid_at,
  };
};

const resolveAccountResponse = z.object({ account_name: z.string().min(1) });

export const resolveAccountName = async (
  options: PaystackClientOptions,
  accountNumber: string,
  bankCode: string,
): Promise<ResolvedAccount> => {
  const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
  const response = await data(
    options,
    {
      operation: 'bank.resolve',
      method: 'GET',
      // The account number is a query VALUE, and providerRequest redacts every query value before
      // logging — which is why it goes here rather than into the path.
      path: `/bank/resolve?${query.toString()}`,
      idempotent: true,
    },
    resolveAccountResponse,
  );

  return { accountName: response.account_name };
};

const bankListResponse = z.array(
  z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    active: z.boolean().optional(),
    is_deleted: z.boolean().nullish(),
    supports_transfer: z.boolean().nullish(),
  }),
);

/**
 * Every bank a seller could actually be paid into, not the first page of them.
 *
 * The cannibalized client issued one `GET /bank` and returned whatever came back, so the list silently
 * stopped partway through the alphabet and a seller below the cut could not be paid. Two things make
 * the paging real: `use_cursor=true`, without which Paystack's `meta` carries no `next` at all and the
 * loop would break after one page exactly as before; and a check that the cursor actually moved, so a
 * provider repeating one cursor yields one page rather than twenty copies of it.
 *
 * Inactive, deleted and transfer-incapable banks are dropped: this list feeds a payout destination
 * picker, and offering a bank that cannot receive a transfer only moves the failure to the payout.
 */
export const listBanks = async (options: PaystackClientOptions): Promise<Bank[]> => {
  const banks: Bank[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_BANK_PAGES; page++) {
    const query = new URLSearchParams({
      country: 'nigeria',
      currency: 'NGN',
      use_cursor: 'true',
      perPage: String(BANK_PAGE_SIZE),
      ...(cursor ? { next: cursor } : {}),
    });
    const envelope = await call(options, {
      operation: 'bank.list',
      method: 'GET',
      path: `/bank?${query.toString()}`,
      idempotent: true,
    });
    // A page with no `data` at all is a malformed answer, not an empty list. Treating it as empty is
    // how a scheduled refresh would overwrite a good cached list with nothing.
    if (envelope.data === undefined) {
      throw new ApiError(
        502,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'The payment provider returned no data',
        'paystack bank.list',
      );
    }
    for (const bank of validate('bank.list', bankListResponse, envelope.data)) {
      if (bank.active === false || bank.is_deleted === true || bank.supports_transfer === false) continue;
      banks.push({ name: bank.name, code: bank.code });
    }

    const next = envelope.meta?.next ?? undefined;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }

  return banks;
};

const createTransferRecipientResponse = z.object({ recipient_code: z.string().min(1) });

export const createTransferRecipient = async (
  options: PaystackClientOptions,
  input: TransferRecipientInput,
): Promise<TransferRecipientResult> => {
  const response = await data(
    options,
    {
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
    },
    createTransferRecipientResponse,
  );

  return { providerRecipientId: response.recipient_code };
};

const initiateTransferResponse = z.object({
  transfer_code: z.string().min(1),
  status: z.string().min(1),
});

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
  const response = await data(
    options,
    {
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
    },
    initiateTransferResponse,
  );

  return { providerTransferId: response.transfer_code, status: mapTransferStatus(response.status) };
};

const createRefundResponse = z.object({
  id: z.union([z.string().min(1), z.number().int()]).transform(String),
  status: z.string().min(1),
});

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
 * `input.reference` is deliberately NOT sent. Paystack's Refund API accepts no client reference, so
 * ours is bookkeeping on our side only (m8 §3) and the returned `id` is the sole correlation Paystack
 * knows about — which is why `webhookIngest` must match a refund event on `providerRefundId`.
 *
 * Paystack does not refund its own processing fee, so the ledger must treat that fee as absorbed by
 * the platform on every refunded trade rather than recovered (m8 §5).
 */
export const initiateRefund = async (
  options: PaystackClientOptions,
  input: InitiateRefundInput,
): Promise<InitiateRefundResult> => {
  const response = await data(
    options,
    {
      operation: 'refund.initiate',
      method: 'POST',
      path: '/refund',
      body: {
        transaction: input.chargeProviderReference,
        amount: input.amountMinor,
        ...(input.reason === undefined ? {} : { merchant_note: input.reason }),
      },
    },
    createRefundResponse,
  );

  return { providerRefundId: response.id, status: mapRefundStatus(response.status) };
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
