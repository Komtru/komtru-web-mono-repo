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

  describe('asChild', () => {
    it('lends the treatment to a link, so navigation stays a link', () => {
      render(
        <Button variant="secondary" asChild>
          <a href="/trades">Go to Trades</a>
        </Button>,
      );
      const link = screen.getByRole('link', { name: 'Go to Trades' });
      expect(link.tagName).toBe('A');
      expect(screen.queryByRole('button')).toBeNull();
      expect(link.getAttribute('href')).toBe('/trades');
    });

    it('gives the child the same classes the button would have carried', () => {
      const { unmount } = render(<Button variant="secondary">Go to Trades</Button>);
      const asButton = screen.getByRole('button').className;
      unmount();
      render(
        <Button variant="secondary" asChild>
          <a href="/trades">Go to Trades</a>
        </Button>,
      );
      expect(screen.getByRole('link').className).toBe(asButton);
    });

    it("keeps the child's own classes as well as the treatment", () => {
      render(
        <Button asChild>
          <a href="/x" className="mt-[4px]">
            Continue
          </a>
        </Button>,
      );
      expect(screen.getByRole('link').className).toContain('mt-[4px]');
    });

    it('hands the child every prop it was given, not just the classes', () => {
      const onClick = vi.fn();
      render(
        <Button asChild onClick={onClick} aria-label="Go to your Trades" data-testid="way-out">
          <a href="/trades">Go to Trades</a>
        </Button>,
      );
      const link = screen.getByRole('link', { name: 'Go to your Trades' });
      expect(link.getAttribute('data-testid')).toBe('way-out');
      fireEvent.click(link);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("runs the child's own handler as well as the one it was lent", () => {
      const order: string[] = [];
      render(
        <Button asChild onClick={() => order.push('button')}>
          <a href="/x" onClick={() => order.push('child')}>
            Continue
          </a>
        </Button>,
      );
      fireEvent.click(screen.getByRole('link'));
      expect(order).toEqual(['child', 'button']);
    });

    it('lets the child win where the two disagree about a plain attribute', () => {
      render(
        <Button asChild id="from-button">
          <a href="/x" id="from-child">
            Continue
          </a>
        </Button>,
      );
      expect(screen.getByRole('link').id).toBe('from-child');
    });

    it('refuses to pretend a link can be disabled', () => {
      // `disabled` is not an attribute an `<a>` has, so the treatment would dim a control that is
      // still perfectly clickable. Which element to render is the caller's decision to get right.
      expect(() =>
        render(
          <Button asChild disabled>
            <a href="/x">Continue</a>
          </Button>,
        ),
      ).toThrow(/disabled/);
    });

    it('refuses anything but a single element, because there is nothing to lend it to', () => {
      const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => render(<Button asChild>plain text</Button>)).toThrow(/asChild/);
      expect(() =>
        render(
          <Button asChild>
            <a href="/a">a</a>
            <a href="/b">b</a>
          </Button>,
        ),
      ).toThrow(/asChild/);
      silence.mockRestore();
    });
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
