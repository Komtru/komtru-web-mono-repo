// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PublicShell } from '../../src/index.js';
import '../primitives/setup.js';

describe('PublicShell', () => {
  it('draws no navigation — it is a page a buyer lands on cold', () => {
    const { container } = render(<PublicShell aside="Hero">Listings</PublicShell>);
    expect(container.querySelector('nav')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('draws no header at all unless a page asks for one, which is D8', () => {
    const { container } = render(<PublicShell aside="Hero">Listings</PublicShell>);
    expect(container.querySelector('header')).toBeNull();
  });

  it('draws the brand-only bar when a page names itself, which is T5', () => {
    render(<PublicShell brandLabel="Komtru">Listings</PublicShell>);
    expect(screen.getByText('Komtru')).toBeDefined();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('stacks to one column below lg and splits at lg', () => {
    const { container } = render(<PublicShell aside="Hero">Listings</PublicShell>);
    const aside = container.querySelector('aside')?.className ?? '';
    expect(aside).toContain('w-full');
    expect(aside).toContain('lg:w-[280px]');
    expect(container.querySelector('aside')?.parentElement?.className).toContain('lg:flex-row');
  });

  it('puts the aside before the main, because the hero is the page’s subject', () => {
    const { container } = render(<PublicShell aside="Hero">Listings</PublicShell>);
    const row = container.querySelector('aside')?.parentElement;
    expect([...(row?.children ?? [])].map((child) => child.tagName)).toEqual(['ASIDE', 'MAIN']);
  });

  it('is still a main landmark with no aside at all', () => {
    render(<PublicShell>Listings</PublicShell>);
    expect(screen.getByRole('main').textContent).toBe('Listings');
  });

  it('steps the page padding from 20px to the desktop 24px', () => {
    const { container } = render(<PublicShell>Listings</PublicShell>);
    const region = container.querySelector('main')?.parentElement?.parentElement?.className ?? '';
    expect(region).toContain('p-[20px]');
    expect(region).toContain('lg:p-[24px]');
  });

  it('has no gallery frame', () => {
    const { container } = render(<PublicShell>Listings</PublicShell>);
    expect(container.firstElementChild?.className).toContain('min-h-dvh');
  });
});
