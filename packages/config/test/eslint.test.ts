import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { komtruEslint } from '../eslint/index.mjs';

const fixtures = path.dirname(fileURLToPath(new URL('./fixtures/clean.ts', import.meta.url)));

const lint = async (file: string) => {
  const eslint = new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: komtruEslint({ tsconfigRootDir: fixtures, project: './tsconfig.json' }),
  });
  const [result] = await eslint.lintFiles([path.join(fixtures, file)]);
  return result?.messages ?? [];
};

describe('komtruEslint', () => {
  it('reports a floating promise using type information', async () => {
    const messages = await lint('floating-promise.ts');
    expect(messages.map((m) => m.ruleId)).toContain('@typescript-eslint/no-floating-promises');
  });

  it('reports nothing on clean code', async () => {
    expect(await lint('clean.ts')).toEqual([]);
  });
});
