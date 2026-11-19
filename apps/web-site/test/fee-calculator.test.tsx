// @vitest-environment jsdom
// The pricing page's calculator: the one place on this site that quotes a figure someone will
// hold Komtru to, so the rate and the arithmetic are tested, not just the rendering.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FeeCalculator, feeMinor, formatNaira } from '../src/pricing/FeeCalculator';

afterEach(cleanup);

const slider = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>('Item price');
const setPrice = (naira: number): void => {
  fireEvent.change(slider(), { target: { value: String(naira) } });
};
const side = (name: 'Buyer' | 'Seller'): void => {
  fireEvent.click(screen.getByRole('button', { name }));
};

/**
 * The value cell of the breakdown row labelled `label`.
 *
 * "Item price" is both the slider's label and a row, so the match is narrowed to the one inside a
 * `.tr2` rather than taken from `getByText` alone.
 */
const row = (label: string): string => {
  const cell = screen.getAllByText(label).find((el) => el.closest('.tr2') !== null);
  const text = cell?.closest('.tr2')?.textContent ?? '';
  return text.slice(label.length);
};

describe('the fee maths', () => {
  /*
   * `config/fees.yaml` sets `buyer_protection_fee.rate_bps: 150`. If someone changes the rate in
   * the component without changing the file, or the other way round, this is the test that says so.
   */
  it('charges 1.5% of the item price', () => {
    expect(feeMinor(150_000 * 100)).toBe(2_250 * 100);
    expect(feeMinor(1_000_000 * 100)).toBe(15_000 * 100);
    expect(feeMinor(10_000 * 100)).toBe(150 * 100);
  });

  it('works in whole kobo, so no stop on the slider can render a fraction', () => {
    for (let price = 10_000; price <= 2_000_000; price += 5_000) {
      const minor = price * 100;
      expect(Number.isInteger(feeMinor(minor))).toBe(true);
      expect(formatNaira(minor + feeMinor(minor))).not.toMatch(/\./);
    }
  });

  it('formats naira the way the reference does', () => {
    expect(formatNaira(152_250 * 100)).toBe('₦152,250');
  });
});

describe('FeeCalculator', () => {
  it('opens on the buyer side at ₦150,000', () => {
    const { container } = render(<FeeCalculator />);
    expect(screen.getByRole('button', { name: 'Buyer' }).getAttribute('aria-pressed')).toBe('true');
    expect(slider().value).toBe('150000');
    expect(container.querySelector('output')?.textContent).toBe('₦150,000');
  });

  it('shows the buyer what they pay, fee included', () => {
    render(<FeeCalculator />);
    expect(row('Item price')).toBe('₦150,000');
    expect(row('Buyer Protection Fee (1.5%)')).toBe('₦2,250');
    expect(row('Delivery')).toBe('Set in agreement');
    expect(row('Total you pay')).toBe('₦152,250');
  });

  it('recomputes the fee and the total when the slider moves', () => {
    const { container } = render(<FeeCalculator />);
    setPrice(1_000_000);
    expect(container.querySelector('output')?.textContent).toBe('₦1,000,000');
    expect(row('Buyer Protection Fee (1.5%)')).toBe('₦15,000');
    expect(row('Total you pay')).toBe('₦1,015,000');
  });

  /*
   * The seller breakdown is not the buyer's with a different total: there is no Buyer Protection
   * Fee on this side, seller fees are not set yet, and what the seller needs is the figure that
   * lands and when it lands.
   */
  it('shows the seller what they receive, and when', () => {
    render(<FeeCalculator />);
    side('Seller');
    expect(row('Item price')).toBe('₦150,000');
    expect(row('Seller fees')).toBe('To be confirmed');
    expect(row('You receive')).toBe('₦150,000 before fees');
    expect(row('Paid')).toBe('After buyer confirms');
    expect(screen.queryByText(/Buyer Protection Fee \(/)).toBeNull();
    expect(screen.queryByText('Total you pay')).toBeNull();
  });

  it('keeps the price when the side changes', () => {
    render(<FeeCalculator />);
    setPrice(500_000);
    side('Seller');
    expect(row('You receive')).toBe('₦500,000 before fees');
    side('Buyer');
    expect(row('Total you pay')).toBe('₦507,500');
  });

  it('announces the slider in naira rather than as a bare number', () => {
    render(<FeeCalculator />);
    setPrice(250_000);
    expect(slider().getAttribute('aria-valuetext')).toBe('₦250,000');
  });

  it('puts the breakdown in a live region, so the total is announced when it changes', () => {
    render(<FeeCalculator />);
    const region = screen.getByText('Total you pay').closest('[aria-live]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('aria-atomic')).toBe('true');
  });

  /* The rate is not confirmed, and the page has to keep saying so. */
  it('keeps the caveat about the rate', () => {
    render(<FeeCalculator />);
    expect(
      screen.getByText('1.5% Buyer Protection Fee is an example rate until fees are confirmed.'),
    ).toBeTruthy();
  });
});
