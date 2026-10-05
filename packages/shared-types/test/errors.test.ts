import { describe, expect, it } from 'vitest';
import { isProblemDetails, PROBLEM_CODES, problemDetailsSchema, problemTypeUri } from '../src/errors.js';

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
      ]),
    );
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
