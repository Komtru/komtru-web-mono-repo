// The templates are not compiled by this package — they import `next`, which the apps own, and they
// reference an `src/app-config.ts` that only exists inside an app. So nothing would notice a
// template that named an export this package stopped having. This test is what notices.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const templates = path.join(root, 'templates');

const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
};

const walk = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const templateFiles = walk(templates);
const read = (file: string) => readFileSync(file, 'utf8');
const relative = (file: string) => path.relative(templates, file);

interface KomtruImport {
  specifier: string;
  names: string[];
}

const komtruImports = (source: string): KomtruImport[] =>
  [...source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'(@komtru\/app-kit[^']*)'/g)].map(
    (match) => ({
      specifier: match[2]!,
      names: match[1]!
        .split(',')
        .map(
          (name) =>
            name
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0]!,
        )
        .filter(Boolean),
    }),
  );

/** The names each entry point actually exports, read from the source the entry point points at. */
const exportedNames = async (specifier: string): Promise<string[]> => {
  const entry = specifier.replace('@komtru/app-kit', '.');
  const sourceByEntry: Record<string, string> = {
    '.': 'src/index.ts',
    './next': 'src/next/index.ts',
    './react': 'src/react/index.ts',
    './sentry': 'src/sentry.ts',
    './ui': 'src/ui/index.ts',
  };
  const file = sourceByEntry[entry];
  if (file === undefined) return [];
  const loaded: Record<string, unknown> = (await import(path.join(root, file))) as Record<string, unknown>;
  return Object.keys(loaded);
};

describe('the per-app templates', () => {
  it('ships one for every file an app has to add', () => {
    expect(templateFiles.map(relative).sort()).toEqual([
      'app/api/auth/[action]/route.ts',
      'app/error.tsx',
      'app/global-error.tsx',
      'app/globals.css',
      'app/not-found.tsx',
      'instrumentation-client.ts',
      'instrumentation.ts',
      'middleware.ts',
      'tsconfig.json',
    ]);
  });

  it.each(templateFiles.filter((file) => file.endsWith('.ts') || file.endsWith('.tsx')))(
    '%s imports only subpaths this package declares',
    (file) => {
      const declared = Object.keys(manifest.exports);
      for (const { specifier } of komtruImports(read(file))) {
        expect(declared).toContain(specifier.replace('@komtru/app-kit', '.'));
      }
    },
  );

  it.each(templateFiles.filter((file) => file.endsWith('.ts') || file.endsWith('.tsx')))(
    '%s imports only names this package exports',
    async (file) => {
      for (const { specifier, names } of komtruImports(read(file))) {
        const available = await exportedNames(specifier);
        for (const name of names) expect(available, `${specifier} has no ${name}`).toContain(name);
      }
    },
  );

  it('actually imports something from this package in every template', () => {
    // `.css` and `.json` templates reference it without an import statement.
    for (const file of templateFiles.filter((name) => /\.tsx?$/.test(name))) {
      expect(komtruImports(read(file)).length, relative(file)).toBeGreaterThan(0);
    }
  });

  it('wires the matcher on the middleware template, or middleware runs on every asset', () => {
    expect(read(path.join(templates, 'middleware.ts'))).toContain('KOMTRU_MATCHER');
  });

  it('never hands `process.env` whole to readAppConfig from a file that runs in the browser', () => {
    // Next defines `process.env.NEXT_PUBLIC_X` one literal at a time and never `process.env`
    // itself; in the browser `process.env` is `{}`, so `readAppConfig(appSpec, process.env)` throws
    // at module evaluation and the app white-screens.
    for (const file of templateFiles.filter((name) => !name.endsWith('.css'))) {
      const source = read(file);
      const inBrowser = source.includes("'use client'") || file.includes('instrumentation-client');
      if (!inBrowser) continue;
      expect(source, relative(file)).not.toMatch(/readAppConfig\(\s*appSpec,\s*process\.env\s*\)/);
    }
  });

  it('ships a tsconfig that extends the Next.js preset T-002 created for it', () => {
    const tsconfig = JSON.parse(read(path.join(templates, 'tsconfig.json'))) as { extends: string };
    expect(tsconfig.extends).toBe('@komtru/config/tsconfig/next.json');
  });

  it('reads the session secret from the server, never from a NEXT_PUBLIC_ variable', () => {
    for (const file of templateFiles) {
      expect(read(file), relative(file)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);
    }
  });

  it('reaches the stylesheet from the one template that replaces the whole document', () => {
    // `global-error.tsx` renders its own `<html>`, so the root layout's CSS import is not in scope.
    expect(read(path.join(templates, 'app/global-error.tsx'))).toContain('@komtru/app-kit/styles.css');
  });

  it('marks the auth route dynamic, so a cookie is never baked into a static response', () => {
    expect(read(path.join(templates, 'app/api/auth/[action]/route.ts'))).toContain(
      "export const dynamic = 'force-dynamic'",
    );
  });
});
