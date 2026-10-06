// The integration fixtures this module seeds have to be legal under the rules the database enforces.
// They are seeded behind KOMTRU_INFRA_TESTS, so a fixture that violates one of those rules fails in
// somebody else's infra run, hours later, with a 23505 from a test-support helper and no clue which
// rule it broke. These are the same checks, as unit tests, where they are cheap and immediate.
import { describe, expect, it } from 'vitest';
import { skeleton } from '../../../src/modules/identity/domain/username/skeleton.js';
import { TYPEAHEAD_HANDLES } from './infrastructure/postgres/support.js';

const USERNAME_FORMAT = /^[a-z][a-z0-9._]{2,29}$/;

describe('the typeahead fixture (M1 §6.3)', () => {
  it('is more than one page of results, so the cap on eight is actually exercised', () => {
    expect(TYPEAHEAD_HANDLES.length).toBeGreaterThan(8);
  });

  it('shares the prefix the typeahead tests search on', () => {
    for (const handle of TYPEAHEAD_HANDLES) expect(handle.startsWith('jan')).toBe(true);
  });

  it('passes the users_username_format CHECK', () => {
    for (const handle of TYPEAHEAD_HANDLES) expect(handle).toMatch(USERNAME_FORMAT);
  });

  it('is distinct under the skeleton, not merely distinct as text', () => {
    // users_username_skeleton_unique covers the SKELETON. Two handles that differ as strings and
    // agree as skeletons cannot coexist, whatever the fixture intended.
    const skeletons = TYPEAHEAD_HANDLES.map((handle) => skeleton(handle));
    expect(new Set(skeletons).size).toBe(TYPEAHEAD_HANDLES.length);
  });
});

describe('why the typeahead fixture is not generated (T-035 post-merge)', () => {
  it('shows that appending a counter does not produce distinct handles', () => {
    // The fixture this replaced. Recorded as a test rather than as a comment because it is a real
    // property of §6.3 and the reason the obvious thing does not work: digits fold to the letters
    // they are confusable with, and then runs collapse.
    expect(skeleton('janedoe6')).toBe(skeleton('janedoe9')); // 6 and 9 both fold to g
    expect(skeleton('janedoe11')).toBe(skeleton('janedoe1')); // 1 folds to l, and 'll' collapses to 'l'

    const counted = Array.from({ length: 12 }, (_, i) => `janedoe${String(i)}`);
    expect(new Set(counted.map((handle) => skeleton(handle))).size).toBe(10);
  });
});
