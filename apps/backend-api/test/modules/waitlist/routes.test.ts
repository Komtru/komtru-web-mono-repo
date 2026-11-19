import { describe, expect, it } from 'vitest';
import { waitlistRoutes } from '../../../src/modules/waitlist/http/routes.js';
import { signupBody } from '../../../src/modules/waitlist/http/validations.js';
import type { Db } from '../../../src/db/index.js';

const routes = waitlistRoutes({ db: () => ({}) as Db });

describe('the waitlist route', () => {
  it('is public, because nobody signing up has an account', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0]?.scope).toBe('PUBLIC');
    expect(routes[0]?.path).toBe('/waitlist');
    expect(routes[0]?.status).toBe(201);
  });

  /* A public form has no user to count against, so the budget has to be on the address. */
  it('is rate limited per IP', () => {
    expect(routes[0]?.rateLimit?.by).toEqual(['ip']);
  });

  /* `false` is the claim that a repeat is harmless. The unique index on the contact is what makes
     it true; if that index ever goes, this answer is wrong. */
  it('declares a repeat harmless rather than demanding an idempotency key', () => {
    expect(routes[0]?.retryable).toBe(false);
  });
});

describe('the signup body', () => {
  const valid = { name: 'Ada', contact: 'ada@example.com', intent: 'BUY', city: 'Lagos' };

  it('accepts what the site sends', () => {
    expect(signupBody.parse(valid)).toEqual(valid);
  });

  it('rejects an intent that is not one of the three', () => {
    expect(signupBody.safeParse({ ...valid, intent: 'BROWSE' }).success).toBe(false);
  });

  /* Strict: a public endpoint should not quietly accept fields it will not store. */
  it('rejects anything extra', () => {
    expect(signupBody.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
  });

  it.each(['name', 'contact', 'city'])('requires %s', (field) => {
    const { [field]: _omitted, ...rest } = valid as Record<string, unknown>;
    expect(signupBody.safeParse(rest).success).toBe(false);
  });

  /*
   * The source is read from the `Origin` header, never from the body. A caller who could name
   * their own source could file a test signup on the real launch list, or vice versa — and the
   * strict schema is what stops the field being quietly accepted and then ignored.
   */
  it('refuses a caller-supplied source', () => {
    expect(signupBody.safeParse({ ...valid, source: 'PROD' }).success).toBe(false);
  });
});
