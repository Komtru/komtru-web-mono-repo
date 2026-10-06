// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeLoader } from '../../src/index.js';
import './setup.js';

describe('NodeLoader', () => {
  it('names the wait rather than spinning at the person', () => {
    render(<NodeLoader title="Verifying payment" body="Usually under 30 seconds." />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Verifying payment');
    expect(status.textContent).toContain('Usually under 30 seconds.');
  });

  it('pulses three nodes at the reference timing, offset so they read as a handshake', () => {
    const { container } = render(<NodeLoader title="Verifying payment" />);
    const dots = [...container.querySelectorAll('span')].slice(0, 3).map((dot) => dot.className);
    expect(dots).toHaveLength(3);
    for (const dot of dots) expect(dot).toContain('animate-[nodePulse_1.4s_ease-in-out_infinite]');
    expect(dots[1]).toContain('[animation-delay:.18s]');
    expect(dots[2]).toContain('[animation-delay:.36s]');
  });

  it('holds still for anyone who asked motion to stop', () => {
    const { container } = render(<NodeLoader title="Verifying payment" />);
    expect(container.querySelector('span')?.className).toContain('motion-reduce:animate-none');
  });

  it('hides the dots themselves — the caption is the message', () => {
    const { container } = render(<NodeLoader title="Verifying payment" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
