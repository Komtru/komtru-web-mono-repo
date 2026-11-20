// RFC 9457 problem details: the one error shape every Komtru API returns. Clients branch on `code`,
// never on `title` or `detail`, which are human copy and may change.
import { z } from 'zod';

export const PROBLEM_CODES = [
  // Generic
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  // Two 401s the client acts on differently: `TOKEN_EXPIRED` means a refresh will probably work,
  // `SESSION_REVOKED` means it will not and the only honest next step is to sign out (T-031).
  'TOKEN_EXPIRED',
  'SESSION_REVOKED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'IDEMPOTENCY_KEY_REUSED',
  'INTERNAL',
  // Domain (each named in a ticket)
  // One code for every §S3 authentication failure — nonexistent user, wrong password, social-only
  // account, throttled account, suspended account. A second code for any of them would be the
  // enumeration oracle the uniform response exists to close (T-032).
  'INVALID_CREDENTIALS',
  // A wrong, expired or exhausted OTP challenge. Carries `attemptsRemaining` as an RFC 9457
  // extension member when there are attempts left, which is what screen E3b renders (T-032).
  'OTP_INVALID',
  /**
   * A §S7 sensitive action asked for before the caller re-proved it is them (T-036). 403, not 401:
   * the access token is perfectly valid, and the api-client answers a 401 with a refresh and then a
   * sign-out — which would end a legitimate session in the middle of the action. The refusal is
   * conditional, and the problem body's `acceptedFactors` names the condition.
   */
  'STEP_UP_REQUIRED',
  'INVALID_TRANSITION',
  'NO_LOGISTICS_ACCESS',
  'LAST_ADMIN',
  'ALREADY_HAS_ACTIVE_COMPANY',
  'ALREADY_A_MEMBER',
  'MERCHANT_CANNOT_BUY',
  // The selling limit for an account without merchant status (owner ruling 2026-11-20).
  'SELL_LIMIT_PER_TRADE',
  'SELL_LIMIT_DAILY',
  'BUYER_NOT_VERIFIED',
  'SELLER_NOT_VERIFIED',
  'ADDRESS_REQUIRED',
  'PARK_NOT_AVAILABLE_IN_CITY',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  // T-040. A file M20 D4 tombstoned answers 410 and must stay distinguishable from "not yours",
  // which answers 404 on purpose so the endpoint is not an existence oracle. A client holding a
  // soft file_ref_id branches on this to show "removed" rather than "sign in again".
  'FILE_TOMBSTONED',
  // Every storage account in a pool is at its quota, so the upload fails closed (M20 D6). Capacity,
  // not a bug: the same reason PAYMENT_PROVIDER_UNAVAILABLE is not INTERNAL.
  'FILE_STORAGE_UNAVAILABLE',
  // T-050. M6 §2 requires a confirmed email AND phone before an identity check. The client renders
  // "verify your contact details first" and links to that screen, which it cannot do from a bare
  // CONFLICT — and the user's next action is a different one from every other 409 on this surface.
  'CONTACT_VERIFICATION_REQUIRED',
  // The KYC provider is not configured on this environment, or its liveness surface is unreachable.
  // Capacity and configuration, not a bug — the same reason PAYMENT_PROVIDER_UNAVAILABLE is not
  // INTERNAL. The client shows "we can't verify you right now, try later" rather than an error
  // that invites the user to re-enter a correct number.
  'VERIFICATION_PROVIDER_UNAVAILABLE',
  /**
   * T-051. M6 §4's level-3 ladder, as the two refusals a client can act on.
   *
   * `IDENTITY_VERIFICATION_REQUIRED` is "a business is operated by a verified human" — the CAC
   * submission refuses until level 2 is held. `BUSINESS_VERIFICATION_REQUIRED` is the next rung: the
   * bank name-match has nothing to match the account against until a CAC-registered business name
   * is on file. Both are 409s on the happy path of a real user in the wrong order, and each one
   * sends the client to a DIFFERENT screen — which a bare CONFLICT cannot do, and which is the whole
   * reason they are not one code.
   */
  'IDENTITY_VERIFICATION_REQUIRED',
  'BUSINESS_VERIFICATION_REQUIRED',
  /**
   * T-051. A social-proof challenge code whose 24 hours are up (M6 §6.6).
   *
   * Distinct from `NOT_FOUND` and from a plain `CONFLICT` because the client's next action is
   * specific and automatable: claim the handle again for a fresh code. A code that stayed valid
   * indefinitely would mean a bio edited once, months ago, by someone who has since sold the
   * account, still proving ownership today.
   */
  'CHALLENGE_EXPIRED',
  // T-046. A user already has the most distinct city requests waiting that one person may hold;
  // the client says "wait for a decision" rather than the generic conflict copy.
  'CITY_REQUEST_LIMIT_REACHED',
  // T-042. A user already holds the most live delivery addresses one account may keep; the client
  // says "archive one first" rather than the generic conflict copy.
  'ADDRESS_LIMIT_REACHED',
  /**
   * T-073. The three refusals of a withdrawal or a payout preference that each send the seller to a
   * different place: add a verified bank account (`PAYOUT_ACCOUNT_REQUIRED`), withdraw less
   * (`INSUFFICIENT_BALANCE`), or contact support because risk has stopped payouts (`PAYOUT_HELD`).
   */
  'PAYOUT_ACCOUNT_REQUIRED',
  'INSUFFICIENT_BALANCE',
  'PAYOUT_HELD',
  /**
   * F-081. The three refusals of "verify this contact channel", each sending the client somewhere
   * different, which a bare `CONFLICT` cannot do.
   *
   * `ALREADY_VERIFIED` is not a problem to solve: the badge is already green and the screen should
   * stop offering the action. `CONTACT_TAKEN` means somebody else has PROVEN that address — the
   * person needs a different one, or support. `CONTACT_REQUIRED` means the account holds no address
   * on that channel at all (a phone-first signup has no email), so the form must ask for one before
   * a code can go anywhere.
   */
  'ALREADY_VERIFIED',
  'CONTACT_TAKEN',
  'CONTACT_REQUIRED',
  // Deliberately NOT added: `TOO_MANY_REQUESTS`. `RATE_LIMITED` above is already this platform's
  // 429, used by the route limiter, by identity's party-lookup budget and by the OTP resend
  // throttle, and it already carries `retryAfter` as an extension member. The social-proof
  // re-check interval is the same fact — "you did this too recently" — and a second spelling of it
  // would force every client to branch on two codes to render one message.
] as const;

export const problemCodeSchema = z.enum(PROBLEM_CODES);
export type ProblemCode = z.infer<typeof problemCodeSchema>;

// `about:blank` is RFC 9457's default type; otherwise only https URIs, never javascript: and the like.
const problemType = z.union([z.literal('about:blank'), z.url({ protocol: /^https$/ })]);

const problemFields = {
  type: problemType,
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
};

/**
 * What the backend emits: `code` must be one this package knows. Extension members (`traceId` and
 * the like) are kept, as RFC 9457 allows.
 */
export const problemDetailsSchema = z.looseObject({ ...problemFields, code: problemCodeSchema });
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/**
 * What a client accepts: any code string. Apps deploy separately from the backend, so a client must
 * still recognise a problem whose code a newer server added, and fall back to its generic handling.
 */
export const receivedProblemSchema = z.looseObject({ ...problemFields, code: z.string().min(1) });
export type ReceivedProblem = z.infer<typeof receivedProblemSchema>;

const PROBLEM_DOCS_BASE = 'https://docs.komtru.com/problems/';

/** `INVALID_TRANSITION` → `https://docs.komtru.com/problems/invalid-transition`. */
export const problemTypeUri = (code: ProblemCode): string =>
  `${PROBLEM_DOCS_BASE}${code.toLowerCase().replaceAll('_', '-')}`;

/** True for any problem-details body, including codes this client version does not know yet. */
export const isProblemDetails = (value: unknown): value is ReceivedProblem =>
  receivedProblemSchema.safeParse(value).success;

/** Narrows a received problem's code to one this client knows, or `undefined`. */
export const knownProblemCode = (problem: ReceivedProblem): ProblemCode | undefined => {
  const parsed = problemCodeSchema.safeParse(problem.code);
  return parsed.success ? parsed.data : undefined;
};
