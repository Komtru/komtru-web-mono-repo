// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { REFERENCE_FILE } from '../scripts/extract-tokens.js';
import { KomtruLogo, KomtruMark } from '../src/index.js';

afterEach(cleanup);

// Resolved from this file rather than through the extractor's `REFERENCE_HTML`: under jsdom, Vite
// rewrites an imported module's `import.meta.url`, and this test file's own URL is the reliable one.
// Paths, not `new URL(..., import.meta.url)`: under jsdom Vite rewrites that pattern into an asset
// URL, and these files are read off disk rather than bundled.
const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '../../../docs/design-reference', REFERENCE_FILE), 'utf8');

/** The mark as the reference writes it next to `text`, reduced to the attributes that define it. */
function referenceMark(text: 'Komtru' | 'Komtru Ops') {
  const pattern = new RegExp(
    `(<svg viewBox="0 0 24 24"[^>]*>(?:<circle[^>]*/>){3}<path[^>]*/></svg>)${text}<`,
  );
  const found = pattern.exec(html);
  if (!found?.[1]) throw new Error(`The reference has no mark beside "${text}"`);
  const svg = found[1];
  const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(svg)?.[1];
  return {
    stroke: attribute('stroke'),
    strokeWidth: attribute('stroke-width'),
    strokeLinecap: attribute('stroke-linecap'),
    nodes: [...svg.matchAll(/<circle cx="([^"]*)" cy="([^"]*)" r="([^"]*)"\/>/g)].map((m) => m.slice(1)),
    path: /<path d="([^"]*)"/.exec(svg)?.[1],
  };
}

/** The same reduction over what a component rendered, so the two are comparable. */
function renderedMark(container: HTMLElement) {
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('No svg rendered');
  return {
    stroke: svg.getAttribute('stroke') ?? undefined,
    strokeWidth: svg.getAttribute('stroke-width') ?? undefined,
    strokeLinecap: svg.getAttribute('stroke-linecap') ?? undefined,
    nodes: [...svg.querySelectorAll('circle')].map((c) => [
      c.getAttribute('cx'),
      c.getAttribute('cy'),
      c.getAttribute('r'),
    ]),
    path: svg.querySelector('path')?.getAttribute('d') ?? undefined,
  };
}

describe('KomtruMark', () => {
  it('draws the reference three-node mark', () => {
    const { container } = render(<KomtruMark />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
    expect(renderedMark(container)).toEqual(referenceMark('Komtru'));
  });

  it('hides itself from the accessibility tree when it carries no name', () => {
    const { container } = render(<KomtruMark />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  });

  it('becomes a named image when given a title', () => {
    render(<KomtruMark title="Komtru" />);
    expect(screen.getByRole('img', { name: 'Komtru' })).toBeDefined();
  });

  it('scales from one size prop', () => {
    const { container } = render(<KomtruMark size={20} />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('20');
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('20');
  });
});

describe('KomtruLogo', () => {
  it('renders the consumer wordmark the way .scr-logo does', () => {
    const { container } = render(<KomtruLogo />);
    expect(container.textContent).toBe('Komtru');
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.fontFamily).toBe('var(--font-display)');
    expect(root.style.fontWeight).toBe('600');
    expect(root.style.fontSize).toBe('14px');
    expect(root.style.gap).toBe('6px');
    expect(renderedMark(container)).toEqual(referenceMark('Komtru'));
  });

  it('renders the ops wordmark the way .ds-logo does', () => {
    const { container } = render(<KomtruLogo product="ops" />);
    expect(container.textContent).toBe('Komtru Ops');
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.fontSize).toBe('13px');
    expect(root.style.gap).toBe('7px');
    expect(renderedMark(container)).toEqual(referenceMark('Komtru Ops'));
  });

  it('names itself for assistive technology', () => {
    render(<KomtruLogo product="ops" />);
    expect(screen.getByRole('img', { name: 'Komtru Ops' })).toBeDefined();
  });

  it('needs no client boundary, so a server component can render it', () => {
    for (const file of ['KomtruMark.tsx', 'KomtruLogo.tsx']) {
      const source = readFileSync(path.join(here, '../src/brand', file), 'utf8');
      expect(source).not.toContain('use client');
      expect(source).not.toMatch(/\buse(State|Effect|Ref|Memo)\b/);
    }
  });
});
