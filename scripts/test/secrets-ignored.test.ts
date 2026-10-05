import { describe, expect, it } from 'vitest';
import { findUnignored, MUST_BE_IGNORED, MUST_BE_TRACKABLE } from '../check-secrets-ignored.mjs';

describe('secret files stay out of git', () => {
  it('ignores the old backend .env and every app .env', () => {
    expect(findUnignored(MUST_BE_IGNORED)).toEqual([]);
  });

  it('keeps .env.example files trackable', () => {
    expect(MUST_BE_TRACKABLE.filter((p) => findUnignored([p]).length === 0)).toEqual([]);
  });

  it('reports a path that git would track', () => {
    expect(findUnignored(['README.md'])).toEqual(['README.md']);
  });
});
