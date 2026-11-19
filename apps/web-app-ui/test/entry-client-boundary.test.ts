// A component that calls a React hook from a Server Component builds, and passes in jsdom, and then crashes its route
// at runtime: `/` did, on its first wide build, when Welcome began reading the window. So walk what a Server Component
// reaches, stopping at every `'use client'` module (the boundary), and fail on any module on the server side of it that
// calls a hook. The entry screens, the system screens and the walkthrough are checked; the walk starts from every
// route file in `app/`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const CHECKED = ['src/entry', 'src/system', 'src/welcome', 'app/(entry)'];

const sourcesUnder = (folder: string): string[] =>
  readdirSync(join(ROOT, folder)).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });

const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

/** `'use client'` as the first statement, after any comments. */
const isClient = (source: string): boolean =>
  /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/.test(source);

const callsAHook = (source: string): boolean => /(?<![.\w])use[A-Z]\w*\s*[(<]/.test(source);

const importsOf = (file: string, source: string): string[] =>
  [...source.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)].flatMap((match) => {
    const base = join(dirname(file), match[1]!);
    return [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')].filter(
      (candidate) => existsSync(join(ROOT, candidate)),
    );
  });

/** Every module a Server Component can end up running on the server: the walk stops at a client module. */
function serverSide(): Set<string> {
  const seen = new Set<string>();
  const queue = sourcesUnder('app').filter((file) => !isClient(read(file)));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file, read(file))) {
      if (!seen.has(next) && !isClient(read(next))) queue.push(next);
    }
  }
  return seen;
}

describe('the screens that call a hook', () => {
  const server = serverSide();
  const hooked = CHECKED.flatMap(sourcesUnder).filter((file) => callsAHook(read(file)));

  it('finds the modules it is meant to guard', () => {
    expect(hooked.some((file) => file.endsWith('Welcome.tsx'))).toBe(true);
    expect(hooked.some((file) => file.endsWith('LoginForm.tsx'))).toBe(true);
    expect(server.has('app/page.tsx')).toBe(true);
  });

  it.each(hooked)('%s is not run by a Server Component', (file) => {
    const reachedFromTheServer = server.has(file) && !isClient(read(file));
    expect(
      reachedFromTheServer,
      `${relative(ROOT, join(ROOT, file))} calls a hook but a Server Component reaches it`,
    ).toBe(false);
  });
});
