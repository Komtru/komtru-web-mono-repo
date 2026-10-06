import { describe, expect, it } from 'vitest';
import { isUniqueViolation, pgErrorIn } from '../../src/db/errors.js';

/** What drizzle 0.45 hands a caller: its own Error, with the driver's on `cause`. */
const wrapped = (depth: number): Error => {
  let error: unknown = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'user_emails_verified_unique',
  });
  for (let i = 0; i < depth; i += 1) {
    error = Object.assign(new Error('Failed query: update …'), { cause: error });
  }
  return error as Error;
};

describe('reading a Postgres error through drizzle', () => {
  it('finds the driver error at the top level', () => {
    expect(pgErrorIn(wrapped(0))?.code).toBe('23505');
  });

  it('finds it through the wrapper drizzle actually throws', () => {
    // drizzle-orm 0.45.3 raises DrizzleQueryError('Failed query: …') with the pg error on `cause`,
    // so a catch that reads `error.code` sees undefined and silently rethrows a 500.
    expect(pgErrorIn(wrapped(1))?.code).toBe('23505');
    expect(pgErrorIn(wrapped(3))?.constraint).toBe('user_emails_verified_unique');
  });

  it('matches a constraint by name through the chain', () => {
    expect(isUniqueViolation(wrapped(2), 'user_emails_verified_unique')).toBe(true);
    expect(isUniqueViolation(wrapped(2), 'user_phones_verified_unique')).toBe(false);
  });

  it('is false for anything that is not a unique violation', () => {
    expect(isUniqueViolation(new Error('nope'), 'anything')).toBe(false);
    expect(isUniqueViolation(null, 'anything')).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: '23514', constraint: 'c' }), 'c')).toBe(
      false,
    );
  });

  it('terminates on a cause that points at itself', () => {
    const loop: { cause?: unknown; code?: string } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop, 'anything')).toBe(false);
  });
});
