/* eslint-disable komtru-design/no-raw-hex -- asserting the compiled output means naming the colours. */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);
const presetPath = fileURLToPath(new URL('../tailwind/preset.css', import.meta.url));

/** Resolves `@import 'tailwindcss'` the way a bundler would, so the preset compiles standalone. */
async function loadStylesheet(id: string, base: string) {
  const specifier = id === 'tailwindcss' ? 'tailwindcss/index.css' : id;
  const resolved = specifier.startsWith('.') ? path.resolve(base, specifier) : require_.resolve(specifier);
  return {
    path: resolved,
    base: path.dirname(resolved),
    content: await readFile(resolved, 'utf8'),
  };
}

const build = async (candidates: string[]) => {
  const compiler = await compile(await readFile(presetPath, 'utf8'), {
    base: path.dirname(presetPath),
    loadStylesheet,
  });
  return compiler.build(candidates);
};

describe('@komtru/config/tailwind/preset.css', () => {
  it('maps the design tokens onto utilities', async () => {
    const css = await build([
      'bg-trust-indigo',
      'text-slate',
      'border-border-hairline',
      'p-4',
      'gap-6',
      'rounded-md',
      'rounded-full',
      'font-display',
      'font-mono',
      'shadow-card',
      'ease-standard',
    ]);
    expect(css).toContain('background-color: var(--trust-indigo)');
    expect(css).toContain('color: var(--slate)');
    expect(css).toContain('border-color: var(--border-hairline)');
    expect(css).toContain('padding: var(--sp-4)');
    expect(css).toContain('gap: var(--sp-6)');
    expect(css).toContain('border-radius: var(--r-md)');
    expect(css).toContain('border-radius: var(--r-full)');
    expect(css).toContain('font-family: var(--font-display)');
    expect(css).toContain('font-family: var(--font-mono)');
    expect(css).toContain('transition-timing-function: var(--ease-standard)');
    expect(css).toContain('--tw-shadow:');
  });

  it('publishes the reference custom properties for plain CSS to use', async () => {
    const css = await build(['bg-trust-indigo']);
    expect(css).toContain('--trust-emerald: #159768;');
    expect(css).toContain('--dur-trust: 400ms;');
    expect(css).toContain("--font-display: 'Space Grotesk','Inter',sans-serif;");
    expect(css).toContain('--ease-standard: cubic-bezier(.4,0,.2,1);');
  });

  it('reads rounded-r-md as tailwind does, as the right-hand side only', async () => {
    // The ticket's `rounded-r-md` is not the `--r-md` radius: `r` is Tailwind's side modifier, so
    // the full-radius utility is `rounded-md`. Naming a `--radius-r-md` token would have made one
    // class mean both things.
    const css = await build(['rounded-r-md']);
    expect(css).toContain('border-top-right-radius: var(--r-md)');
    expect(css).not.toMatch(/\.rounded-r-md \{\n\s+border-radius:/);
  });

  it('introduces no dark theme', async () => {
    const css = await build(['bg-trust-indigo', 'text-midnight-text']);
    expect(css).not.toMatch(/prefers-color-scheme|\.dark\b/);
  });
});
