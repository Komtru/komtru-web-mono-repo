// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogoBar, TopBar } from '../../src/index.js';
import '../primitives/setup.js';

const BELL = <svg aria-hidden viewBox="0 0 24 24" />;

describe('TopBar', () => {
  it('keeps the title centred when there is no trailing action', () => {
    // The reference writes `<div style="width:32px">` opposite the back button on every screen that
    // has no action, so the title does not drift off centre.
    const { container } = render(<TopBar title="Enter code" back={{ label: 'Back' }} />);
    expect(container.querySelectorAll('.w-\\[32px\\]')).toHaveLength(2);
  });

  it('leaves a spacer on both sides when it has neither control', () => {
    const { container } = render(<TopBar title="Terms & Privacy" />);
    expect(container.querySelectorAll('.w-\\[32px\\]')).toHaveLength(2);
  });

  it('names the back control, which is otherwise a bare chevron', () => {
    render(<TopBar title="Enter code" back={{ label: 'Back to sign up' }} />);
    expect(screen.getByRole('button', { name: 'Back to sign up' })).toBeDefined();
  });

  it('draws the reference chevron when the caller gives no icon', () => {
    const { container } = render(<TopBar title="Log in" back={{ label: 'Back' }} />);
    expect(container.querySelector('path')?.getAttribute('d')).toBe('M15 6l-6 6 6 6');
  });

  it('renders a destination as a link rather than a button', () => {
    render(<TopBar title="Home" action={{ label: 'Alerts', icon: BELL, href: '/alerts' }} />);
    expect(screen.getByRole('link', { name: 'Alerts' }).getAttribute('href')).toBe('/alerts');
  });

  it('puts the unread dot inside the action, not beside it', () => {
    render(<TopBar title="Home" action={{ label: 'Alerts', icon: BELL, badge: true }} />);
    expect(screen.getByRole('button', { name: 'Alerts' }).querySelector('.bg-risk')).not.toBeNull();
  });

  it('draws no dot when there is nothing unread', () => {
    render(<TopBar title="Home" action={{ label: 'Alerts', icon: BELL }} />);
    expect(screen.getByRole('button', { name: 'Alerts' }).querySelector('.bg-risk')).toBeNull();
  });

  it('positions every control, so the unread dot cannot escape onto the page', () => {
    // `.tb-dot` is `position:absolute`; a control with no positioned ancestor resolves it against
    // whatever the screen's nearest one is. The reference declares `position:relative` on
    // `.tb-icon` only, which is why `back` cannot take a badge at all.
    const { container } = render(
      <TopBar title="Home" back={{ label: 'Back' }} action={{ label: 'Alerts', icon: BELL }} />,
    );
    for (const control of container.querySelectorAll('button')) {
      expect(control.className.split(/\s+/)).toContain('relative');
    }
  });

  it('sticks to the top of the screen, above the body', () => {
    const { container } = render(<TopBar title="Search" />);
    const header = container.querySelector('header');
    expect(header?.className).toContain('sticky');
    expect(header?.className).toContain('top-0');
    expect(header?.className).toContain('z-[5]');
  });

  it('is a banner landmark', () => {
    render(<TopBar title="Search" />);
    expect(screen.getByRole('banner')).toBeDefined();
  });
});

describe('LogoBar', () => {
  it('draws the consumer lockup by default and the ops one on request', () => {
    const { rerender } = render(<LogoBar />);
    expect(screen.getByRole('img', { name: 'Komtru' })).toBeDefined();
    rerender(<LogoBar product="ops" />);
    expect(screen.getByRole('img', { name: 'Komtru Ops' })).toBeDefined();
  });

  it('is flush against the body — a tab root has nowhere to go back to', () => {
    const { container } = render(<LogoBar />);
    const header = container.querySelector('header');
    expect(header?.className).not.toContain('sticky');
    expect(header?.className).not.toContain('border-b');
  });

  it('takes a class list, so a one-shell app can hide it where the top nav takes over', () => {
    const { container } = render(<LogoBar className="md:hidden" />);
    expect(container.querySelector('header')?.className).toContain('md:hidden');
  });

  it('carries the same action control the top bar does, badge and all', () => {
    render(<LogoBar action={{ label: 'Alerts', icon: BELL, badge: true }} />);
    expect(screen.getByRole('button', { name: 'Alerts' }).querySelector('.bg-risk')).not.toBeNull();
  });

  it('draws no control when a screen gives it no action', () => {
    render(<LogoBar />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
