// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, EmptyState } from '../../src/index.js';
import { expectFocusRing } from './setup.js';

const ICON = <svg aria-hidden viewBox="0 0 24 24" />;

describe('EmptyState', () => {
  it('explains, then names the benefit, then offers the way out — in that order', () => {
    const { container } = render(
      <EmptyState
        icon={ICON}
        title="No protected Trades yet"
        body="Start one, or enter a Trade Code from a seller — every completed Trade adds to your Trust Profile."
        action={<Button>Start a Trade</Button>}
        secondaryAction={<Button variant="secondary">Enter a Trade Code</Button>}
      />,
    );
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text.indexOf('No protected Trades yet')).toBeLessThan(text.indexOf('every completed Trade'));
    expect(text.indexOf('every completed Trade')).toBeLessThan(text.indexOf('Start a Trade'));
  });

  it('puts the way out within reach of the keyboard', () => {
    render(
      <EmptyState
        title="No protected Trades yet"
        body="Start one."
        action={<Button>Start a Trade</Button>}
      />,
    );
    expectFocusRing(screen.getByRole('button', { name: 'Start a Trade' }));
  });

  it('turns the icon risk-coloured when it is a failure rather than an emptiness', () => {
    const { container } = render(
      <EmptyState tone="error" icon={ICON} title="We could not load your Trades" body="Try again." />,
    );
    expect(container.querySelector('[aria-hidden="true"]')?.className).toContain('bg-risk-soft');
  });

  it('draws no icon circle when the screen gives no icon', () => {
    const { container } = render(<EmptyState title="Nothing here" body="Yet." />);
    expect(container.querySelector('.rounded-\\[50\\%\\]')).toBeNull();
  });

  it('stands on its own with no action at all', () => {
    render(<EmptyState title="No results" body="Try a different spelling." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
