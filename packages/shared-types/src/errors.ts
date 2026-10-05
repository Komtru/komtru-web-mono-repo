// RFC 9457 problem details: the one error shape every Komtru API returns. Clients branch on `code`,
// never on `title` or `detail`, which are human copy and may change.
import { z } from 'zod';

export const PROBLEM_CODES = [
  // Generic
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'IDEMPOTENCY_KEY_REUSED',
  'INTERNAL',
  // Domain (each named in a ticket)
  'INVALID_TRANSITION',
  'NO_LOGISTICS_ACCESS',
  'LAST_ADMIN',
  'ALREADY_HAS_ACTIVE_COMPANY',
  'ALREADY_A_MEMBER',
  'MERCHANT_CANNOT_BUY',
  'ADDRESS_REQUIRED',
  'PARK_NOT_AVAILABLE_IN_CITY',
] as const;

export const problemCodeSchema = z.enum(PROBLEM_CODES);
export type ProblemCode = z.infer<typeof problemCodeSchema>;

export const problemDetailsSchema = z.object({
  type: z.url(),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  code: problemCodeSchema,
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

const PROBLEM_DOCS_BASE = 'https://docs.komtru.com/problems/';

/** `INVALID_TRANSITION` → `https://docs.komtru.com/problems/invalid-transition`. */
export const problemTypeUri = (code: ProblemCode): string =>
  `${PROBLEM_DOCS_BASE}${code.toLowerCase().replaceAll('_', '-')}`;

export const isProblemDetails = (value: unknown): value is ProblemDetails =>
  problemDetailsSchema.safeParse(value).success;
