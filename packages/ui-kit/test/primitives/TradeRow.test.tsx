// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TRADE_STAGES, TradeProgress, TradeRow } from '../../src/index.js';
import { expectFocusRing } from './setup.js';

describe('TradeProgress', () => {
  it('reports where the trade is, by name', () => {
    render(<TradeProgress stage={3} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(bar.getAttribute('aria-valuetext')).toBe('Shipped');
  });

  it('paints the stages behind as done, the current one as active and the rest as waiting', () => {
    render(<TradeProgress stage={3} />);
    const segments = [...screen.getByRole('progressbar').children].map((node) => node.className);
    expect(segments.map((c) => c.includes('bg-trust-emerald'))).toEqual([true, true, false, false, false]);
    expect(segments.map((c) => c.includes('bg-trust-indigo'))).toEqual([false, false, true, false, false]);
    expect(segments.map((c) => c.includes('bg-stone-gray'))).toEqual([false, false, false, true, true]);
  });

  it('labels the five stages the reference names', () => {
    render(<TradeProgress stage={1} />);
    for (const stage of TRADE_STAGES) expect(screen.getByText(stage)).toBeDefined();
  });

  it('refuses a stage outside the five', () => {
    expect(() => render(<TradeProgress stage={6} />)).toThrow(RangeError);
    expect(() => render(<TradeProgress stage={0} />)).toThrow(RangeError);
  });
});

describe('TradeRow', () => {
  it('leads with the amount, in the mono face the reference prints money in', () => {
    render(<TradeRow amount="₦452,000" />);
    expect(screen.getByText('₦452,000').className).toContain('font-mono');
  });

  it('carries the status chip and the counterparty together', () => {
    render(
      <TradeRow
        amount="₦452,000"
        status={{ tone: 'protected', label: 'Protected' }}
        counterparty={{ name: 'TechEdge NG', initials: 'TE' }}
        sub="iPhone 13 Pro · Awaiting shipment"
      />,
    );
    expect(screen.getByText('Protected')).toBeDefined();
    expect(screen.getByText('TechEdge NG')).toBeDefined();
    expect(screen.getByText('iPhone 13 Pro · Awaiting shipment')).toBeDefined();
  });

  it('stays out of the tab order when there is nowhere to go', () => {
    render(<TradeRow amount="₦89,500" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is a link when it navigates, and takes the keyboard ring', () => {
    render(<TradeRow amount="₦452,000" href="/trades/88190" />);
    expectFocusRing(screen.getByRole('link'));
  });

  it('is a button when it only acts, and fires once', () => {
    const onClick = vi.fn();
    render(<TradeRow amount="₦452,000" onClick={onClick} />);
    const row = screen.getByRole('button');
    expectFocusRing(row);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
