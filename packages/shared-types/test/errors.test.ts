import { describe, expect, it } from 'vitest';
import {
  isProblemDetails,
  knownProblemCode,
  PROBLEM_CODES,
  problemDetailsSchema,
  problemTypeUri,
} from '../src/errors.js';

const valid = {
  type: 'https://docs.komtru.com/problems/invalid-transition',
  title: 'This trade cannot move to that state',
  status: 409,
  code: 'INVALID_TRANSITION',
  detail: 'A trade in PENDING_PAYMENT cannot be shipped.',
};

describe('problemDetailsSchema', () => {
  it('parses a valid problem', () => {
    expect(problemDetailsSchema.parse(valid)).toEqual(valid);
  });

  it('accepts field-level validation errors', () => {
    const withErrors = {
      ...valid,
      code: 'VALIDATION_FAILED',
      status: 422,
      errors: [{ path: 'amount', message: 'Must be positive' }],
    };
    expect(problemDetailsSchema.parse(withErrors).errors).toHaveLength(1);
  });

  it('rejects an unknown code and a success status', () => {
    expect(problemDetailsSchema.safeParse({ ...valid, code: 'NOPE' }).success).toBe(false);
    expect(problemDetailsSchema.safeParse({ ...valid, status: 200 }).success).toBe(false);
  });

  it('includes every code the tickets name', () => {
    expect(PROBLEM_CODES).toEqual(
      expect.arrayContaining([
        'INVALID_TRANSITION',
        'NO_LOGISTICS_ACCESS',
        'LAST_ADMIN',
        'ALREADY_HAS_ACTIVE_COMPANY',
        'ALREADY_A_MEMBER',
        'MERCHANT_CANNOT_BUY',
        'ADDRESS_REQUIRED',
        'PARK_NOT_AVAILABLE_IN_CITY',
        'IDEMPOTENCY_KEY_REUSED',
        // T-040: a 410 for a file M20 D4 tombstoned must stay distinguishable from "not yours",
        // which is a 404 by design, and a client branches on `code`.
        'FILE_TOMBSTONED',
        'FILE_STORAGE_UNAVAILABLE',
      ]),
    );
  });
});

describe('client tolerance', () => {
  it('keeps RFC 9457 extension members such as traceId', () => {
    const parsed = problemDetailsSchema.parse({ ...valid, traceId: 'abc123' }) as Record<string, unknown>;
    expect(parsed.traceId).toBe('abc123');
  });

  it('still recognises a problem whose code a newer server added', () => {
    const future = { ...valid, code: 'SOME_FUTURE_CODE' };
    expect(isProblemDetails(future)).toBe(true);
    expect(isProblemDetails(future) && knownProblemCode(future)).toBeUndefined();
    expect(knownProblemCode(valid)).toBe('INVALID_TRANSITION');
  });

  it('accepts about:blank and rejects non-https type URIs', () => {
    expect(problemDetailsSchema.safeParse({ ...valid, type: 'about:blank' }).success).toBe(true);
    expect(problemDetailsSchema.safeParse({ ...valid, type: 'javascript:alert(1)' }).success).toBe(false);
    expect(problemDetailsSchema.safeParse({ ...valid, type: 'http://example.com/p' }).success).toBe(false);
  });
});

describe('problemTypeUri', () => {
  it('derives a stable documentation URI from the code', () => {
    expect(problemTypeUri('INVALID_TRANSITION')).toBe('https://docs.komtru.com/problems/invalid-transition');
  });
});

describe('isProblemDetails', () => {
  it('recognises a problem body and rejects anything else', () => {
    expect(isProblemDetails(valid)).toBe(true);
    expect(isProblemDetails({ message: 'boom' })).toBe(false);
    expect(isProblemDetails(null)).toBe(false);
  });
});

describe('the codes T-032 answers with', () => {
  it('knows INVALID_CREDENTIALS and OTP_INVALID', () => {
    expect(PROBLEM_CODES).toContain('INVALID_CREDENTIALS');
    expect(PROBLEM_CODES).toContain('OTP_INVALID');
  });

  it('gives them the documented problem type uri', () => {
    expect(problemTypeUri('INVALID_CREDENTIALS')).toBe(
      'https://docs.komtru.com/problems/invalid-credentials',
    );
    expect(problemTypeUri('OTP_INVALID')).toBe('https://docs.komtru.com/problems/otp-invalid');
  });

  it('keeps an extension member a client does not know, as RFC 9457 allows', () => {
    const parsed = problemDetailsSchema.parse({
      type: 'https://docs.komtru.com/problems/otp-invalid',
      title: 'That code does not match',
      status: 422,
      code: 'OTP_INVALID',
      attemptsRemaining: 2,
    });
    expect(parsed).toMatchObject({ attemptsRemaining: 2 });
  });
});

describe('the codes T-051 answers with', () => {
  it('knows the three refusals the level-3 ladder needs', () => {
    expect(PROBLEM_CODES).toContain('IDENTITY_VERIFICATION_REQUIRED');
    expect(PROBLEM_CODES).toContain('BUSINESS_VERIFICATION_REQUIRED');
    expect(PROBLEM_CODES).toContain('CHALLENGE_EXPIRED');
  });

  /**
   * The social-proof re-check throttle answers `RATE_LIMITED`, which already exists and already
   * means exactly this — the platform limiter, the OTP resend throttle and identity's lookup budget
   * all use it for "you did this too recently, here is how long to wait". A second 429 code spelled
   * `TOO_MANY_REQUESTS` would be the same fact under two names, and a client would have to branch on
   * both to show one message.
   */
  it('does not add a second name for a 429', () => {
    expect(PROBLEM_CODES).toContain('RATE_LIMITED');
    expect(PROBLEM_CODES).not.toContain('TOO_MANY_REQUESTS');
  });

  it('gives each one the documented problem type uri', () => {
    expect(problemTypeUri('BUSINESS_VERIFICATION_REQUIRED')).toBe(
      'https://docs.komtru.com/problems/business-verification-required',
    );
    expect(problemTypeUri('CHALLENGE_EXPIRED')).toBe('https://docs.komtru.com/problems/challenge-expired');
  });
});
