import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const primitives = path.join(here, '../../src/primitives');
const sources = readdirSync(primitives).filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'));

/** Only these keep state, so only these need a client boundary when a Next app renders them. */
const CLIENT_COMPONENTS = new Set([
  'FileDropzone.tsx',
  'OtpInput.tsx',
  'Select.tsx',
  'Sheet.tsx',
  'TextField.tsx',
  'Toast.tsx',
  'Toggle.tsx',
]);

describe('the primitive sources', () => {
  it('never reaches for ./fonts, which throws outside a Next build', () => {
    for (const name of sources) {
      const source = readFileSync(path.join(primitives, name), 'utf8');
      expect(source, `${name} imports fonts`).not.toMatch(/from '\.\.?\/fonts/);
      expect(source, `${name} imports next/font`).not.toContain('next/font');
    }
  });

  it("marks the stateful primitives 'use client' and leaves the rest renderable on the server", () => {
    for (const name of sources) {
      const source = readFileSync(path.join(primitives, name), 'utf8');
      const directive = source.startsWith("'use client';");
      expect(directive, `${name} client boundary`).toBe(CLIENT_COMPONENTS.has(name));
    }
  });
});
