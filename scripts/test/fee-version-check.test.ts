import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findVersionProblems } from '../../tools/fee-version-check/check.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const base = readFileSync(resolve(repoRoot, 'config/fees.yaml'), 'utf8');

describe('findVersionProblems', () => {
  it('is clean for the committed config/fees.yaml against itself', () => {
    expect(findVersionProblems(base, base)).toEqual([]);
  });

  it('accepts the commit that adds the file', () => {
    expect(findVersionProblems(null, base)).toEqual([]);
  });

  it('accepts a value change with a version bump', () => {
    const head = base.replace('rate_bps: 150', 'rate_bps: 200').replace('2026-11-20.1', '2026-11-20.2');
    expect(findVersionProblems(base, head)).toEqual([]);
  });

  it('rejects a value change with no version bump, naming the key', () => {
    const problems = findVersionProblems(base, base.replace('rate_bps: 150', 'rate_bps: 200'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('buyer_protection_fee.rate_bps');
    expect(problems[0]).toContain('version');
  });

  it('names every changed key, not just the first', () => {
    const head = base
      .replace('min_minor: 30000', 'min_minor: 40000')
      .replace('amount_minor: 0', 'amount_minor: 5000');
    expect(findVersionProblems(base, head)).toHaveLength(2);
  });

  it('rejects a removed key and an added one', () => {
    const removed = base.replace('payout_fee: # charged on each seller withdrawal\n  amount_minor: 0\n', '');
    expect(findVersionProblems(base, removed)).toEqual([expect.stringContaining('payout_fee.amount_minor')]);
    expect(findVersionProblems(base, `${base}\nlisting_fee:\n  amount_minor: 100\n`)).toEqual([
      expect.stringContaining('listing_fee.amount_minor'),
    ]);
  });

  it('accepts a comment-only edit', () => {
    expect(findVersionProblems(base, `# a new note\n${base}`)).toEqual([]);
  });

  it('rejects a version that goes backwards', () => {
    const head = base.replace('rate_bps: 150', 'rate_bps: 200').replace('2026-11-20.1', '2026-11-19.9');
    expect(findVersionProblems(base, head)).toEqual([expect.stringContaining('version')]);
  });

  it('rejects a version bumped on its own counter but to a lower one', () => {
    const head = base.replace('2026-11-20.1', '2026-11-20.0');
    expect(findVersionProblems(base, head)).toEqual([expect.stringContaining('version')]);
  });

  it('reports a head file that is not valid YAML rather than passing it', () => {
    expect(findVersionProblems(base, 'version: [unclosed\n')).toEqual([
      expect.stringContaining('not valid YAML'),
    ]);
  });
});
