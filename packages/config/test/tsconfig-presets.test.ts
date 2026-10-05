import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const compile = (project: string) =>
  spawnSync(process.execPath, [tsc, '-p', path.join(project, 'tsconfig.json')], { encoding: 'utf8' });

describe('next tsconfig preset', () => {
  it('typechecks browser code with bundler-style imports', () => {
    const result = compile(fixture('next-app'));
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it('leaves JSX for Next.js to compile', () => {
    const shown = spawnSync(
      process.execPath,
      [tsc, '-p', path.join(fixture('next-app'), 'tsconfig.json'), '--showConfig'],
      { encoding: 'utf8' },
    );
    const { compilerOptions } = JSON.parse(shown.stdout) as { compilerOptions: Record<string, unknown> };
    expect(compilerOptions).toMatchObject({ jsx: 'preserve', noEmit: true, moduleResolution: 'bundler' });
  });
});

describe('library tsconfig preset', () => {
  // Libraries are imported at runtime by the Node backend. An extensionless relative import
  // compiles under `bundler` resolution but fails with ERR_MODULE_NOT_FOUND under Node ESM.
  it('rejects extensionless relative imports at compile time', () => {
    const result = compile(fixture('library-extensionless'));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/TS283[45]/);
  });
});
