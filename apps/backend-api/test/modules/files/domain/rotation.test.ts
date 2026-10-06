// The arithmetic behind quota-aware round-robin (M20 §5 step 5). Pure, and the reason it is tested at
// all is that the wrap-around and the "the account we used last is no longer a candidate" case are
// both invisible from the outside — you cannot tell a correct wrap from a silent reset to the top by
// watching uploads.
import { describe, expect, it } from 'vitest';
import { nextInRotation } from '../../../../src/modules/files/domain/rotation.js';

const accounts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('nextInRotation', () => {
  it('starts at the top when nothing has been used yet', () => {
    expect(nextInRotation(accounts, null)).toEqual({ id: 'a' });
  });

  it('advances one place', () => {
    expect(nextInRotation(accounts, 'a')).toEqual({ id: 'b' });
    expect(nextInRotation(accounts, 'b')).toEqual({ id: 'c' });
  });

  it('wraps round rather than stopping at the end', () => {
    expect(nextInRotation(accounts, 'c')).toEqual({ id: 'a' });
  });

  it('starts at the top when the last account is no longer a candidate', () => {
    // It went NEAR_QUOTA or DISABLED since. Starting from the top is right: the ordering is by
    // rotation_order, not by history.
    expect(nextInRotation(accounts, 'z')).toEqual({ id: 'a' });
  });

  it('spreads four uploads across three accounts evenly', () => {
    let last: string | null = null;
    const picked: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const next = nextInRotation(accounts, last);
      picked.push(next.id);
      last = next.id;
    }
    expect(picked).toEqual(['a', 'b', 'c', 'a']);
  });

  it('refuses to pick from nothing rather than returning undefined', () => {
    expect(() => nextInRotation([], null)).toThrow(/no candidates/);
  });
});
