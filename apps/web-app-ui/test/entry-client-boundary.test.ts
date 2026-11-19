// The entry screens read the window through `useViewport`, which is a client hook. A component that calls it from a
// Server Component builds and passes in jsdom and then crashes the route at runtime (`/` did, on its first wide build),
// so the files that call it must say they are client components.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const FOLDERS = ['src/entry/components', 'src/system'];

describe('the entry screens that read the window', () => {
  const files = FOLDERS.flatMap((folder) =>
    readdirSync(join(ROOT, folder))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => join(folder, name)),
  );

  it.each(files)('%s is a client component if it calls useViewport', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    if (!/\buseViewport\(/.test(source)) return;
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('finds the files it is meant to guard', () => {
    expect(files.some((file) => file.endsWith('Welcome.tsx'))).toBe(true);
    expect(files.some((file) => file.endsWith('LoginForm.tsx'))).toBe(true);
  });
});
