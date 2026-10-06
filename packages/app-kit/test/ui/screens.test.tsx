// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorScreen, NotFoundScreen } from '../../src/ui/index.js';
import { expectNoAxeViolations } from './axe.js';

const home = { homeHref: '/trades', homeLabel: 'Go to Trades' };

// The vitest preset does not enable globals, so React Testing Library's own auto-cleanup never
// registers and every render would stack up in one document.
afterEach(cleanup);

describe('ErrorScreen', () => {
  it("says what happened and what is still safe, in the reference's voice", () => {
    render(<ErrorScreen {...home} />);
    expect(screen.getByRole('heading').textContent).toBe("This page didn't load");
    expect(screen.getByText(/Nothing you were doing was changed/)).toBeTruthy();
  });

  it('never apologises and never shows a stack', () => {
    render(<ErrorScreen {...home} reference="9f3a1c" />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/sorry|oops|unexpected error|Error:/i);
  });

  it('shows the reference in the mono face a Trade code uses', () => {
    render(<ErrorScreen {...home} reference="9f3a1c" />);
    const element = screen.getByText('9f3a1c');
    expect(element.className).toContain('font-mono');
  });

  it('shows nothing where there is no reference', () => {
    const { container } = render(<ErrorScreen {...home} />);
    expect(container.querySelector('.font-mono')).toBeNull();
  });

  it('offers Try again only when there is something to retry', () => {
    const onRetry = vi.fn();
    const { unmount } = render(<ErrorScreen {...home} onRetry={onRetry} />);
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();

    render(<ErrorScreen {...home} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('always gives one way out of the screen', () => {
    render(<ErrorScreen {...home} />);
    expect(screen.getByRole('link', { name: 'Go to Trades' }).getAttribute('href')).toBe('/trades');
  });
});

describe('NotFoundScreen', () => {
  it('states the absence without blaming anyone for it', () => {
    render(<NotFoundScreen {...home} />);
    expect(screen.getByRole('heading').textContent).toBe("That page isn't here");
    expect(screen.getByText(/link may be out of date/)).toBeTruthy();
  });

  it('gives one way out and no retry: there is nothing to try again', () => {
    render(<NotFoundScreen {...home} />);
    expect(screen.getByRole('link', { name: 'Go to Trades' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('both screens', () => {
  it.each([
    ['ErrorScreen', <ErrorScreen key="e" {...home} reference="9f3a1c" onRetry={() => undefined} />],
    ['NotFoundScreen', <NotFoundScreen key="n" {...home} />],
  ])('%s renders no main landmark, because the layout already has one', (_name, element) => {
    // `error.tsx` and `not-found.tsx` render *inside* the app's layout, which already carries the
    // shell's `<main>`. Two `main` landmarks is an axe violation on every error page in the product.
    const { container } = render(element);
    expect(container.querySelector('main')).toBeNull();
  });

  it.each([
    ['ErrorScreen', <ErrorScreen key="e" {...home} reference="9f3a1c" onRetry={() => undefined} />],
    ['NotFoundScreen', <NotFoundScreen key="n" {...home} />],
  ])('%s passes axe', async (_name, element) => {
    const { container } = render(element);
    await expectNoAxeViolations(container);
  });

  it.each([
    ['ErrorScreen', <ErrorScreen key="e" {...home} reference="9f3a1c" onRetry={() => undefined} />],
    ['NotFoundScreen', <NotFoundScreen key="n" {...home} />],
  ])('%s uses tokens, never a raw colour', (_name, element) => {
    const { container } = render(element);
    for (const node of container.querySelectorAll('*')) {
      expect(node.getAttribute('class') ?? '').not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(node.getAttribute('style') ?? '').not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});
