// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewport } from '../src/trade/workspace/viewport';
import { atWidth, unwidth } from './support/viewport';

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
