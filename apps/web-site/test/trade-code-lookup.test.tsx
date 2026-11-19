// @vitest-environment jsdom
// The home page's Trade Code box: the habit the whole band exists to teach.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TradeCodeLookup } from '../src/home/TradeCodeLookup';

afterEach(cleanup);

const check = (code: string): void => {
  fireEvent.change(screen.getByLabelText('Trade Code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
};

describe('TradeCodeLookup', () => {
  it('says nothing until a code is checked', () => {
    render(<TradeCodeLookup />);
    expect(screen.queryByText(/iPhone 13 Pro/)).toBeNull();
    expect(screen.queryByText(/couldn’t find that code/)).toBeNull();
  });

  it('shows the example trade for the example code', () => {
    render(<TradeCodeLookup />);
    check('KMT-482731');
    expect(screen.getByText(/iPhone 13 Pro, 256GB · ₦452,000/)).toBeTruthy();
    expect(screen.getByText('TechEdge NG · ID verified')).toBeTruthy();
  });

  it('accepts the code however it was typed', () => {
    render(<TradeCodeLookup />);
    check('  kmt-482731 ');
    expect(screen.getByText(/iPhone 13 Pro/)).toBeTruthy();
  });

  /*
   * A mistyped digit is the common miss, not a scam. The copy says what to do and — the part that
   * matters to someone who is already worried — that no money has moved.
   */
  it('reassures rather than alarms on a miss', () => {
    render(<TradeCodeLookup />);
    check('KMT-000000');
    expect(screen.getByText(/Nothing has been charged/)).toBeTruthy();
    expect(screen.queryByText(/iPhone 13 Pro/)).toBeNull();
  });

  it('announces the answer, which replaces the one before it', () => {
    render(<TradeCodeLookup />);
    check('KMT-000000');
    check('KMT-482731');
    expect(screen.queryByText(/couldn’t find that code/)).toBeNull();
    expect(screen.getByText(/iPhone 13 Pro/)).toBeTruthy();
  });
});
