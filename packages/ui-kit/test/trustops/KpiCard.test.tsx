// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard } from '../../src/index.js';
import '../primitives/setup.js';
import { expectNoAxeViolations } from './axe.js';

describe('KpiCard', () => {
  it('reads label, then value, then trend', () => {
    const { container } = render(
      <KpiCard label="Period intake" value="342" trend={{ text: '+14.7% vs prior', tone: 'up' }} />,
    );
    expect(container.firstElementChild?.textContent).toBe('Period intake342+14.7% vs prior');
  });

  it('sets the value in mono, because a number a reviewer quotes has to line up', () => {
    const { container } = render(<KpiCard label="Lifetime intake" value="8,492" />);
    expect(container.firstElementChild?.children[1]?.className).toContain('font-mono');
  });

  it('colours a rising trend with success and a flagged one with warning', () => {
    render(<KpiCard label="Period intake" value="342" trend={{ text: '+14.7%', tone: 'up' }} />);
    expect(screen.getByText('+14.7%').className).toContain('text-success-on-soft');
    render(<KpiCard label="Parcels held" value="12" trend={{ text: '3 over 24h', tone: 'flag' }} />);
    expect(screen.getByText('3 over 24h').className).toContain('text-warning-on-soft');
  });

  it('leaves a neutral trend uncoloured, as the reference’s base rule does', () => {
    render(<KpiCard label="Lifetime intake" value="8,492" trend={{ text: 'Since activation' }} />);
    const trend = screen.getByText('Since activation');
    expect(trend.className).not.toContain('text-success-on-soft');
    expect(trend.className).not.toContain('text-warning-on-soft');
  });

  it('renders without a trend at all', () => {
    const { container } = render(<KpiCard label="Exceptions" value="4" />);
    expect(container.firstElementChild?.children).toHaveLength(2);
  });

  it('passes axe', async () => {
    const { container } = render(
      <main>
        <KpiCard label="Protected" value="₦48.2m" trend={{ text: '1,284 active trades' }} />
      </main>,
    );
    await expectNoAxeViolations(container);
  });
});
