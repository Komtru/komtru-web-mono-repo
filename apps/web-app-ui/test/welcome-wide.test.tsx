// @vitest-environment jsdom
// F-067 and F-072: the first-time walkthrough on a tablet (card, 768px+) and a desktop (roomier card, with the three
// points beside the step, 1024px+). The flow is the phone's (see welcome.test.tsx); these pin what the wider drawings
// change, that the phone is not one of them, and that a resize never restarts a step.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoneScreen } from '../src/welcome/DoneScreen';
import { NotificationsScreen } from '../src/welcome/NotificationsScreen';
import { Walkthrough } from '../src/welcome/Walkthrough';
import { markWelcomeArrived, markWelcomeDone, resetWelcome, welcomeDone } from '../src/welcome/state';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, renderWithApi, type CallFn } from './support/trade';
import { atWidth, resizeTo, unwidth, type Width } from './support/viewport';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  api.call.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  resetWelcome();
});
afterEach(() => {
  cleanup();
  unwidth();
  vi.unstubAllGlobals();
});

const WIDE: readonly Width[] = ['tablet', 'desktop'];
const OVERVIEW = 'The three things Komtru does';

function stubNotification(permission: NotificationPermission, after: NotificationPermission = permission) {
  const request = vi.fn(() => Promise.resolve(after));
  vi.stubGlobal('Notification', { permission, requestPermission: request });
  return request;
}

describe.each(WIDE)('the frame at %s', (width) => {
  beforeEach(() => {
    atWidth(width);
  });

  it('draws the walkthrough as a card, with Skip and Next at its foot and not pinned to the window', () => {
    render(<Walkthrough step="1" />);
    const footer = screen.getByRole('button', { name: 'Skip' }).parentElement;
    expect(footer?.className).toContain('md:static');
    expect(footer?.className).toContain('md:bg-none');
    expect(footer).toBe(screen.getByRole('button', { name: 'Next' }).parentElement);
    const card = footer?.parentElement;
    expect(card?.className).toContain('md:rounded');
    expect(card?.className).toContain('md:bg-surface-primary');
    expect(screen.getByRole('main').className).toContain('md:bg-surface-secondary');
  });

  it('keeps the walkthrough: Next goes on, Skip leaves and is remembered, the dots say where it is', () => {
    render(<Walkthrough step="2" />);
    expect(screen.getByRole('img', { name: 'Step 2 of 3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.push).toHaveBeenLastCalledWith('/welcome/3');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(welcomeDone()).toBe(true);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('still sends someone who finished straight on, drawing nothing meanwhile', async () => {
    markWelcomeDone();
    const { container } = render(<Walkthrough step="1" />);
    expect(container.querySelector('main')).toBeNull();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('puts the notification and done actions in the card too', async () => {
    stubNotification('default');
    renderWithApi(api.call, <NotificationsScreen />);
    const allow = screen.getByRole('button', { name: 'Allow notifications' });
    expect(allow.parentElement?.className).toContain('md:static');
    cleanup();
    markWelcomeArrived();
    render(<DoneScreen />);
    const start = await screen.findByRole('link', { name: 'Start a Trade' });
    expect(start.parentElement?.className).toContain('md:static');
  });
});

describe('the overview of the three points', () => {
  it('is drawn on a desktop beside the step, with the current point marked', () => {
    atWidth('desktop');
    render(<Walkthrough step="2" />);
    const list = screen.getByRole('list', { name: OVERVIEW });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Your money stays protected'),
      expect.stringContaining('Always know where things stand'),
      expect.stringContaining('Every trade builds your history'),
    ]);
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    // The step itself is still one heading, not two.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it.each(['mobile', 'phone', 'tablet'] as const)('is not drawn at %s', (width) => {
    atWidth(width);
    render(<Walkthrough step="2" />);
    expect(screen.queryByRole('list', { name: OVERVIEW })).toBeNull();
  });

  it('is not drawn at the notification and done screens, which are not one of the three points', async () => {
    atWidth('desktop');
    stubNotification('default');
    renderWithApi(api.call, <NotificationsScreen />);
    expect(screen.queryByRole('list', { name: OVERVIEW })).toBeNull();
    cleanup();
    markWelcomeArrived();
    render(<DoneScreen />);
    await screen.findByRole('heading', { level: 2, name: "You're all set" });
    expect(screen.queryByRole('list', { name: OVERVIEW })).toBeNull();
  });
});

describe('a resize never restarts anything', () => {
  it('keeps the step on screen, as the same nodes, across phone, tablet and desktop', () => {
    atWidth('phone');
    render(<Walkthrough step="3" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Every trade builds your history' });
    const next = screen.getByRole('button', { name: 'Get started' });
    const dots = screen.getByRole('img', { name: 'Step 3 of 3' });
    for (const width of ['tablet', 'desktop', 'tablet', 'phone', 'desktop'] as const) {
      resizeTo(width);
      expect(screen.getByRole('heading', { level: 2, name: 'Every trade builds your history' })).toBe(
        heading,
      );
      expect(screen.getByRole('button', { name: 'Get started' })).toBe(next);
      expect(screen.getByRole('img', { name: 'Step 3 of 3' })).toBe(dots);
      expect(screen.queryByRole('list', { name: OVERVIEW }) !== null).toBe(width === 'desktop');
    }
    fireEvent.click(next);
    expect(router.push).toHaveBeenLastCalledWith('/welcome/notifications');
  });

  it('keeps an OB4 refusal, its note and the focus on Continue when the window is rotated', async () => {
    stubNotification('default', 'denied');
    atWidth('tablet');
    renderWithApi(api.call, <NotificationsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    const note = await screen.findByText(/Notifications are blocked in your browser/);
    const proceed = screen.getByRole('button', { name: 'Continue' });
    await waitFor(() => expect(document.activeElement).toBe(proceed));
    for (const width of ['desktop', 'phone', 'tablet'] as const) {
      resizeTo(width);
      expect(screen.getByText(/Notifications are blocked in your browser/)).toBe(note);
      expect(screen.getByRole('button', { name: 'Continue' })).toBe(proceed);
      expect(document.activeElement).toBe(proceed);
    }
    expect(screen.queryByRole('button', { name: 'Allow notifications' })).toBeNull();
  });

  it('keeps a request in flight, and then goes on, when the window is resized while the browser is asked', async () => {
    let answer: (value: NotificationPermission) => void = () => undefined;
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: () =>
        new Promise<NotificationPermission>((resolve) => {
          answer = resolve;
        }),
    });
    atWidth('desktop');
    renderWithApi(api.call, <NotificationsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    const allow = screen.getByRole('button', { name: 'Allow notifications' });
    expect((allow as HTMLButtonElement).disabled).toBe(true);
    resizeTo('phone');
    expect(screen.getByRole('button', { name: 'Allow notifications' })).toBe(allow);
    expect((allow as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      answer('granted');
      await Promise.resolve();
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/welcome/done'));
  });

  it('keeps a half-typed Trade Code on the done screen across a resize', async () => {
    markWelcomeArrived();
    atWidth('phone');
    render(<DoneScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enter a Trade Code' }));
    fireEvent.change(screen.getByLabelText('Trade Code'), { target: { value: 'KMT-73' } });
    const field = screen.getByLabelText('Trade Code');
    resizeTo('desktop');
    expect(screen.getByLabelText('Trade Code')).toBe(field);
    expect((field as HTMLInputElement).value).toBe('KMT-73');
    resizeTo('tablet');
    expect(document.activeElement).toBe(field);
  });
});

describe('the phone is the phone', () => {
  it('draws no overview and no wide-only content, and the footer is still the pinned one', () => {
    atWidth('phone');
    render(<Walkthrough step="1" />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });
});

describe('accessibility at every width', () => {
  it.each(['phone', 'tablet', 'desktop'] as const)(
    'OB1 to OB3 have no axe violations at %s',
    async (width) => {
      atWidth(width);
      for (const step of ['1', '2', '3'] as const) {
        const { container, unmount } = render(<Walkthrough step={step} />);
        await expectNoAxeViolations(container, SHELL_RULES);
        unmount();
      }
    },
  );

  it.each(['phone', 'tablet', 'desktop'] as const)(
    'OB4 and OB5 have no axe violations at %s',
    async (width) => {
      atWidth(width);
      stubNotification('default');
      const ob4 = renderWithApi(api.call, <NotificationsScreen />);
      await expectNoAxeViolations(ob4.container, SHELL_RULES);
      cleanup();
      markWelcomeArrived();
      const ob5 = render(<DoneScreen />);
      await screen.findByRole('heading', { level: 2, name: "You're all set" });
      await expectNoAxeViolations(ob5.container, SHELL_RULES);
    },
  );
});
