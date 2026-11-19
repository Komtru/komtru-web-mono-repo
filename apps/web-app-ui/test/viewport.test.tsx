// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewportTier } from '../src/trade/shipping/viewport';
import { useViewport } from '../src/trade/workspace/viewport';
import { atWidth, setWidth, unwidth } from './support/viewport';

afterEach(() => {
  cleanup();
  unwidth();
});

const Probe = () => <p>{useViewport()}</p>;

describe('useViewport', () => {
  it('is a phone where there is no matchMedia, so a suite that does not ask for a width draws the phone', () => {
    render(<Probe />);
    expect(screen.getByText('mobile')).toBeTruthy();
  });

  it.each(['mobile', 'tablet', 'desktop'] as const)('reads %s from the window width', (width) => {
    atWidth(width);
    render(<Probe />);
    expect(screen.getByText(width)).toBeTruthy();
  });
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
