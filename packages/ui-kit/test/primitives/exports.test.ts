import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const primitives = path.join(here, '../../src/primitives');
const sources = readdirSync(primitives).filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'));

/** The shipped modules. Stories are dev-only and never render inside an app's server tree. */
const components = sources.filter((name) => !name.endsWith('.stories.tsx') && name !== 'story-icons.tsx');

/** A hook call means React has to run the module on the client. */
const HOOK = /\buse(State|Effect|LayoutEffect|Ref|Id|Reducer|Callback|Memo|Transition|SyncExternalStore)\(/;

/**
 * So does defining an event handler, because a function cannot cross the server boundary as a prop.
 * Forwarding one it was handed (`onClick={onDismiss}`) does not: that is the caller's function, and
 * the caller is already a client module. Walking the attribute's braces rather than regexing the
 * whole value is what tells the two apart — `onClick={locked ? undefined : () => …}` is a
 * definition, and no flat pattern catches it without also catching the forwards.
 */
function definesEventHandler(source: string): boolean {
  for (const match of source.matchAll(/\bon[A-Z]\w*=\{/g)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') depth -= 1;
      index += 1;
    }
    const value = source.slice(start, index - 1);
    if (value.includes('=>') || /\bfunction\b/.test(value)) return true;
  }
  return false;
}

/** Only these keep state, so only these need a client boundary when a Next app renders them. */
const CLIENT_COMPONENTS = new Set([
  'CollapsibleSideNav.tsx',
  'FileDropzone.tsx',
  'GlobalSearch.tsx',
  'ModeSwitch.tsx',
  'OtpInput.tsx',
  'Select.tsx',
  'Sheet.tsx',
  'TextArea.tsx',
  'TextField.tsx',
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

  it("marks every primitive that uses a hook 'use client', derived from the source rather than a list", () => {
    for (const name of components) {
      const source = readFileSync(path.join(primitives, name), 'utf8');
      const needsClient = HOOK.test(source) || definesEventHandler(source);
      const directive = source.startsWith("'use client';");
      // Derived, not hardcoded: a list only restates today's answer, so adding `useState` to a
      // server component would have passed while breaking every app that rendered it.
      expect(directive, `${name} ${needsClient ? 'needs' : 'needs no'} 'use client'`).toBe(needsClient);
    }
  });

  it('carries no client boundary nobody asked for', () => {
    // The cross-check in the other direction: the hardcoded set is the expected answer, so a
    // directive appearing on a component that gained no hook shows up as a surprise.
    const declared = components.filter((name) =>
      readFileSync(path.join(primitives, name), 'utf8').startsWith("'use client';"),
    );
    expect(new Set(declared)).toEqual(CLIENT_COMPONENTS);
  });
});
