// M1 §6.5: three suggestions on collision, each pre-checked. These cover the pre-checks that are
// pure; the live uniqueness check belongs to the service.
import { describe, expect, it } from 'vitest';
import { validateUsernameFormat } from '../../../../../src/modules/identity/domain/username/policy.js';
import { matchBlockedSubstring } from '../../../../../src/modules/identity/domain/username/reserved.js';
import { skeleton } from '../../../../../src/modules/identity/domain/username/skeleton.js';
import { suggestionCandidates } from '../../../../../src/modules/identity/domain/username/suggest.js';

describe('suggestionCandidates', () => {
  it('suggests valid handles derived from the requested one', () => {
    const candidates = suggestionCandidates('dellstore', 10);
    expect(candidates).toHaveLength(10);
    expect(candidates.every((c) => validateUsernameFormat(c).ok)).toBe(true);
    expect(candidates.every((c) => c.startsWith('dellstore'))).toBe(true);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  // A suffix that folds away leaves the very skeleton that was already taken.
  it('never suggests a handle that folds onto the base skeleton', () => {
    const base = skeleton('dellstore');
    expect(suggestionCandidates('dellstore', 20).every((c) => skeleton(c) !== base)).toBe(true);
  });

  it('never suggests two handles that fold onto each other', () => {
    const candidates = suggestionCandidates('dellstore', 20);
    expect(new Set(candidates.map((c) => skeleton(c))).size).toBe(candidates.length);
  });

  it('never suggests a handle carrying a blocked substring', () => {
    expect(suggestionCandidates('komtru', 10)).toEqual([]);
    expect(suggestionCandidates('dellstore', 20).every((c) => !matchBlockedSubstring(c))).toBe(true);
  });

  it('trims an over-long base so the suffixed handle still fits 30 characters', () => {
    const candidates = suggestionCandidates('a'.repeat(29), 5);
    expect(candidates).toHaveLength(5);
    expect(candidates.every((c) => c.length <= 30)).toBe(true);
  });

  it('returns nothing for input that is not a username at all', () => {
    expect(suggestionCandidates('@@', 3)).toEqual([]);
    expect(suggestionCandidates('jané', 3)).toEqual([]);
  });

  it('normalises the base before deriving from it', () => {
    expect(suggestionCandidates('@DellStore', 3).every((c) => c.startsWith('dellstore'))).toBe(true);
  });

  it('is deterministic for a given base', () => {
    expect(suggestionCandidates('dellstore', 6)).toEqual(suggestionCandidates('dellstore', 6));
  });
});
