// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toast } from '../../src/index.js';
import { expectFocusRing } from './setup.js';

describe('Toast', () => {
  it.each(['info', 'warning', 'success'] as const)('announces the %s tone politely', (tone) => {
    render(<Toast tone={tone} title="Trade Code copied" />);
    const toast = screen.getByRole('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
  });

  it('interrupts for a risk message', () => {
    render(<Toast tone="risk" title="That action could not be queued" />);
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
  });

  it('carries a second line when there is one', () => {
    render(<Toast tone="info" title="Queued" body="It will send when you are back online." />);
    expect(screen.getByText('It will send when you are back online.')).toBeDefined();
  });

  it('offers a named way out only when the screen gives it one', () => {
    render(<Toast tone="info" title="Queued" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('dismisses from the keyboard', () => {
    const onDismiss = vi.fn();
    render(<Toast tone="info" title="Queued" onDismiss={onDismiss} />);
    const button = screen.getByRole('button', { name: 'Dismiss' });
    expectFocusRing(button);
    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
