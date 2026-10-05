// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from '../../src/index.js';
import { expectFocusRing } from './setup.js';

describe('Toggle', () => {
  it('is a switch that reports its own state', () => {
    render(<Toggle label="Marketing" checked={false} />);
    const toggle = screen.getByRole('switch', { name: 'Marketing' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('turns emerald when it is on', () => {
    render(<Toggle label="Shipment updates" checked />);
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.className).toContain('bg-trust-emerald');
  });

  it('flips when it is activated', () => {
    const onChange = vi.fn();
    render(<Toggle label="Marketing" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is a real button, so Space and Enter reach it and the focus ring shows', () => {
    render(<Toggle label="Marketing" checked={false} />);
    const toggle = screen.getByRole('switch');
    // jsdom does not synthesise Space/Enter activation; what can be proved here is that the control
    // is a `<button type="button">`, which is what makes the browser do it.
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expectFocusRing(toggle);
  });

  it('shows a locked setting rather than hiding it, and refuses to change', () => {
    const onChange = vi.fn();
    render(<Toggle label="Dispute & fraud alerts" checked locked onChange={onChange} />);
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-readonly')).toBe('true');
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('slides the knob rather than snapping it, and holds still under reduced motion', () => {
    render(<Toggle label="Two-factor authentication" checked />);
    const knob = screen.getByRole('switch').firstElementChild;
    expect(knob?.className).toContain('translate-x-[14px]');
    expect(knob?.className).toContain('motion-reduce:transition-none');
  });
});
