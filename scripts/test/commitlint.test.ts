import lint from '@commitlint/lint';
import load from '@commitlint/load';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const check = async (message: string) => {
  const config = await load({}, { cwd: repoRoot });
  return lint(
    message,
    config.rules,
    config.parserPreset ? { parserOpts: config.parserPreset.parserOpts as object } : {},
  );
};

describe('commit message rules', () => {
  it('accepts a conventional commit with a scope', async () => {
    expect((await check('feat(identity): add login')).valid).toBe(true);
  });

  it('rejects a message that is not a conventional commit', async () => {
    expect((await check('fixed stuff')).valid).toBe(false);
  });
});
