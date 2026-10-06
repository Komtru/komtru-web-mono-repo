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
  'INVALID_TRANSITION',
  'NO_LOGISTICS_ACCESS',
  'LAST_ADMIN',
  'ALREADY_HAS_ACTIVE_COMPANY',
  'ALREADY_A_MEMBER',
  'MERCHANT_CANNOT_BUY',
  'BUYER_NOT_VERIFIED',
  'SELLER_NOT_VERIFIED',
  'ADDRESS_REQUIRED',
  'PARK_NOT_AVAILABLE_IN_CITY',
  'PAYMENT_PROVIDER_UNAVAILABLE',
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
