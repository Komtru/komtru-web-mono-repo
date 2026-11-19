// @vitest-environment jsdom
// The tier hook the fulfil and payouts screens pick their layout with.
import { cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
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

  it('follows the window when its width changes after mount', () => {
    setWidth('phone');
    render(<Tier />);
    expect(screen.getByText('base')).toBeTruthy();
    setWidth('tablet');
    expect(screen.getByText('md')).toBeTruthy();
    setWidth('desktop');
    expect(screen.getByText('lg')).toBeTruthy();
    setWidth('phone');
    expect(screen.getByText('base')).toBeTruthy();
  });

  it('renders the phone layout on the server without touching the window', () => {
    setWidth('desktop');
    expect(renderToString(<Tier />)).toContain('base');
  });
});
