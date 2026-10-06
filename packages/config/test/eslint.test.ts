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

const reactFixtures = path.join(fixtures, 'react');

const lintReact = async (file: string) => {
  const eslint = new ESLint({
    cwd: reactFixtures,
    overrideConfigFile: true,
    overrideConfig: komtruEslint({
      tsconfigRootDir: reactFixtures,
      project: './tsconfig.json',
      react: true,
    }),
  });
  const [result] = await eslint.lintFiles([path.join(reactFixtures, file)]);
  return result?.messages ?? [];
};

describe('komtruEslint', () => {
  it('reports a floating promise using type information', async () => {
    const messages = await lint('floating-promise.ts');
    expect(messages.map((m) => m.ruleId)).toContain('@typescript-eslint/no-floating-promises');
  });

  it('reports a raw hex colour through the shared plugin', async () => {
    const messages = await lint('raw-hex.ts');
    expect(messages.map((m) => m.ruleId)).toEqual(['komtru-design/no-raw-hex']);
  });

  it('reports nothing on clean code', async () => {
    expect(await lint('clean.ts')).toEqual([]);
  });
});

describe('komtruEslint({ react: true })', () => {
  it('reports a hook called conditionally', async () => {
    const messages = await lintReact('conditional-hook.tsx');
    expect(messages.map((m) => m.ruleId)).toContain('react-hooks/rules-of-hooks');
  });

  it('reports a raw <img> through the Next.js rules', async () => {
    const messages = await lintReact('img-element.tsx');
    expect(messages.map((m) => m.ruleId)).toContain('@next/next/no-img-element');
  });

  it('reports nothing on a clean component', async () => {
    expect(await lintReact('clean.tsx')).toEqual([]);
  });

  it('leaves both rule sets off without react: true', () => {
    const config = komtruEslint({ tsconfigRootDir: reactFixtures, project: './tsconfig.json' });
    const plugins = config.flatMap((entry) => Object.keys(entry.plugins ?? {}));
    expect(plugins).not.toContain('react-hooks');
    expect(plugins).not.toContain('@next/next');
  });
});
