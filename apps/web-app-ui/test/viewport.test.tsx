// @vitest-environment jsdom
// The tier hook the fulfil and payouts screens pick their layout with.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewportTier } from '../src/trade/shipping/viewport';
import { setWidth } from './support/viewport';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Tier(): React.JSX.Element {
  return <p>{useViewportTier()}</p>;
}

describe('useViewportTier', () => {
  it('is a phone where the window cannot be measured', () => {
    render(<Tier />);
    expect(screen.getByText('base')).toBeTruthy();
  });

  it.each([
    ['phone', 'base'],
    ['tablet', 'md'],
    ['desktop', 'lg'],
  ] as const)('reads a %s window as %s', (width, tier) => {
    setWidth(width);
    render(<Tier />);
    expect(screen.getByText(tier)).toBeTruthy();
  });
});
