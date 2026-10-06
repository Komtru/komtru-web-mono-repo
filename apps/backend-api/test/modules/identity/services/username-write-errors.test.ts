// The one branch of the username service an integration test cannot reach on demand: both callers
// pass the availability pre-check and the unique index decides. The shapes below are the real ones
// drizzle-orm 0.45 produces — a plain Error carrying the `pg` error on `cause`, captured from a
// live `tx.update` that violated `users_username_unique`.
import { describe, expect, it } from 'vitest';
import { translateWriteError } from '../../../../src/modules/identity/services/username.service.js';

const drizzleWrapped = (code: string, constraint?: string): Error =>
  Object.assign(new Error('Failed query: update "identity"."users" …'), {
    cause: Object.assign(new Error('db'), { code, ...(constraint ? { constraint } : {}) }),
  });

describe('translateWriteError', () => {
  it('reads a unique violation drizzle buried on cause, rather than letting it escape as a 500', () => {
    const problem = translateWriteError(drizzleWrapped('23505', 'users_username_unique'));
    expect(problem).toMatchObject({ status: 409 });
  });

  it('tells a confusable handle apart from a taken one, through the same wrapping', () => {
    const confusable = translateWriteError(drizzleWrapped('23505', 'users_username_skeleton_unique'));
    const taken = translateWriteError(drizzleWrapped('23505', 'users_username_unique'));
    expect(confusable?.detail).not.toBe(taken?.detail);
  });

  it('maps the format CHECK to 422, not to taken', () => {
    expect(translateWriteError(drizzleWrapped('23514', 'users_username_format'))).toMatchObject({
      status: 422,
    });
  });

  it('leaves an error it does not recognise for the caller to rethrow', () => {
    expect(translateWriteError(drizzleWrapped('40001'))).toBeUndefined();
    expect(translateWriteError(new Error('nothing to do with postgres'))).toBeUndefined();
  });
});
