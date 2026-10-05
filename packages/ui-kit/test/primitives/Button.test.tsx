// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, StickyFooter } from '../../src/index.js';
import { expectFocusRing } from './setup.js';

describe('Button', () => {
  it('is a button, not a submit, unless the caller says otherwise', () => {
    render(<Button>Start a Trade</Button>);
    expect(screen.getByRole('button', { name: 'Start a Trade' })).toHaveProperty('type', 'button');
  });

  it('submits when asked to', () => {
    render(<Button type="submit">Log in</Button>);
    expect(screen.getByRole('button', { name: 'Log in' })).toHaveProperty('type', 'submit');
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)('renders the %s treatment', (variant) => {
    render(<Button variant={variant}>Continue</Button>);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined();
  });

  it('takes the reference focus ring from the keyboard', () => {
    render(<Button>Verify &amp; continue</Button>);
    expectFocusRing(screen.getByRole('button'));
  });

  it('refuses the click and says so when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Accept trade request
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Accept trade request' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls back when it is not disabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Accept</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('StickyFooter', () => {
  it('keeps its actions in the order the screen gave them', () => {
    render(
      <StickyFooter>
        <Button>Accept trade request</Button>
        <Button variant="secondary">Propose changes instead</Button>
      </StickyFooter>,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Accept trade request',
      'Propose changes instead',
    ]);
  });

  it('fades the screen out behind it with the reference gradient', () => {
    const { container } = render(<StickyFooter />);
    expect(container.firstElementChild?.className).toContain(
      'bg-[linear-gradient(to_top,var(--surface-primary)_70%,transparent)]',
    );
  });
});
