// @vitest-environment jsdom
// F-013 (OB1–OB5): the first-time walkthrough. Skippable at any point, remembered, and the notification ask comes last.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoneScreen } from '../src/welcome/DoneScreen';
import { NotificationsScreen } from '../src/welcome/NotificationsScreen';
import { Walkthrough } from '../src/welcome/Walkthrough';
import {
  markWelcomeArrived,
  markWelcomeDone,
  rememberFirstName,
  resetWelcome,
  welcomeArrived,
  welcomeDone,
  welcomeName,
} from '../src/welcome/state';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, callsTo, renderWithApi, type CallFn } from './support/trade';

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
  vi.unstubAllGlobals();
});

describe('OB1–OB3 walkthrough', () => {
  it('OB1 leads with the protection promise, shows 1 of 3 and offers Skip and Next', () => {
    const { container } = render(<Walkthrough step="1" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Your money stays protected' })).toBeTruthy();
    expect(screen.getByText(/Payment sits safely with Komtru, not the seller/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Step 1 of 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    return expectNoAxeViolations(container, SHELL_RULES);
  });

  it('Next goes one screen on, and the last says Get started and goes to the notification ask', () => {
    const { rerender } = render(<Walkthrough step="1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.push).toHaveBeenLastCalledWith('/welcome/2');
    rerender(<Walkthrough step="2" />);
    expect(screen.getByText('Always know where things stand')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Step 2 of 3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.push).toHaveBeenLastCalledWith('/welcome/3');
    rerender(<Walkthrough step="3" />);
    expect(screen.getByText('Every trade builds your history')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(router.push).toHaveBeenLastCalledWith('/welcome/notifications');
  });

  it('Skip leaves the walkthrough at any screen, remembered, without asking for notifications', () => {
    render(<Walkthrough step="2" />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(welcomeDone()).toBe(true);
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sends someone who has already been through it straight on', async () => {
    markWelcomeDone();
    render(<Walkthrough step="1" />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });
});

function stubNotification(permission: NotificationPermission, after: NotificationPermission = permission) {
  const request = vi.fn(() => Promise.resolve(after));
  vi.stubGlobal('Notification', { permission, requestPermission: request });
  return request;
}

describe('OB4 notifications', () => {
  it('says what it will and will not notify about, with Allow first and Not now second', async () => {
    stubNotification('default');
    const { container } = renderWithApi(api.call, <NotificationsScreen />);
    expect(screen.getByRole('heading', { level: 2, name: "Don't miss a status change" })).toBeTruthy();
    expect(screen.getByText(/disputes and fraud alerts, later in Settings/)).toBeTruthy();
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Allow notifications', 'Not now']);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('Allow asks the browser and, with a token source, registers this device, then goes on', async () => {
    stubNotification('default', 'granted');
    answerWith(api.call, {
      'POST /me/devices': (input: unknown) => ({
        id: '0190b0a0-0000-7000-8000-000000000001',
        fingerprintHint: 'abcdef',
        platform: 'WEB',
        status: 'ACTIVE',
        hasPushToken: (input as { body?: { pushToken?: string } }).body?.pushToken !== undefined,
      }),
    });
    renderWithApi(
      api.call,
      <NotificationsScreen tokenSource={{ getToken: () => Promise.resolve('tok-9') }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/welcome/done'));
    const sent = callsTo(api.call, 'POST', '/me/devices');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ platform: 'WEB', pushToken: 'tok-9' });
  });

  it('goes on after a grant even when nothing can be registered, and calls nothing', async () => {
    stubNotification('default', 'granted');
    renderWithApi(api.call, <NotificationsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/welcome/done'));
    expect(api.call).not.toHaveBeenCalled();
  });

  it('Not now moves on without asking the browser', () => {
    const request = stubNotification('default');
    renderWithApi(api.call, <NotificationsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(request).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/welcome/done');
  });

  it('after a refusal says how to undo it and offers Continue instead of a dead button', async () => {
    stubNotification('default', 'denied');
    const { container } = renderWithApi(api.call, <NotificationsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    expect(await screen.findByText(/blocked in your browser/i)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Allow notifications' })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(router.push).toHaveBeenCalledWith('/welcome/done');
  });

  it('shows the blocked explanation straight away when the browser already denied', async () => {
    stubNotification('denied');
    renderWithApi(api.call, <NotificationsScreen />);
    expect(await screen.findByText(/blocked in your browser/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('says so when the browser cannot show notifications, and still lets the person on', async () => {
    vi.stubGlobal('Notification', undefined);
    renderWithApi(api.call, <NotificationsScreen />);
    expect(await screen.findByText(/doesn't support notifications/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(router.push).toHaveBeenCalledWith('/welcome/done');
  });
});

describe('OB5 all set', () => {
  beforeEach(() => {
    markWelcomeArrived();
  });

  it('greets by first name, marks the walkthrough done and offers the two first actions', async () => {
    rememberFirstName('Amaka Obi');
    const { container } = render(<DoneScreen />);
    expect(await screen.findByRole('heading', { level: 2, name: "You're all set, Amaka" })).toBeTruthy();
    expect(
      screen.getByText(/Start your first protected Trade, or find one a seller already sent you/),
    ).toBeTruthy();
    expect(welcomeDone()).toBe(true);
    // Read once, then forgotten: it is not left in storage for whoever uses the phone next.
    expect(welcomeName()).toBeNull();
    const start = screen.getByRole('link', { name: 'Start a Trade' });
    expect(start.getAttribute('href')).toBe('/trade/new');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('has no name to say when none was kept', () => {
    render(<DoneScreen />);
    expect(screen.getByRole('heading', { level: 2, name: "You're all set" })).toBeTruthy();
  });

  it('Enter a Trade Code opens a code field that goes to that trade', () => {
    render(<DoneScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter a Trade Code' }));
    fireEvent.change(screen.getByLabelText('Trade Code'), { target: { value: ' kmt-7398512 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find trade' }));
    expect(router.push).toHaveBeenCalledWith('/trades/KMT-7398512-NG');
  });

  it('shows what a code looks like, and goes nowhere, for an empty or malformed code', () => {
    render(<DoneScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter a Trade Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Find trade' }));
    expect(screen.getByText(/looks like KMT-7398512-NG/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Trade Code'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find trade' }));
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('the gates', () => {
  it('OB4 sends someone who already finished straight on, and draws nothing meanwhile', async () => {
    stubNotification('default');
    markWelcomeDone();
    const { container } = renderWithApi(api.call, <NotificationsScreen />);
    expect(container.textContent).toBe('');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('OB1 draws nothing for someone who already finished, so it never flashes', () => {
    markWelcomeDone();
    const { container } = render(<Walkthrough step="1" />);
    expect(container.textContent).toBe('');
  });

  it('OB5 is not for a deep link: without coming through OB4 it goes to the app and does not mark anything', async () => {
    resetWelcome();
    const { container } = render(<DoneScreen />);
    expect(container.textContent).toBe('');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(welcomeDone()).toBe(false);
  });

  it('OB4 records that the done screen was reached through the flow', () => {
    stubNotification('default');
    renderWithApi(api.call, <NotificationsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(welcomeArrived()).toBe(true);
  });
});

describe('failures never block the way on', () => {
  it('a token call that rejects still ends at OB5', async () => {
    stubNotification('default', 'granted');
    renderWithApi(
      api.call,
      <NotificationsScreen tokenSource={{ getToken: () => Promise.reject(new Error('no fcm')) }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/welcome/done'));
    expect(api.call).not.toHaveBeenCalled();
  });

  it('a registration that fails still ends at OB5', async () => {
    stubNotification('default', 'granted');
    answerWith(api.call, { 'POST /me/devices': new Error('offline') });
    renderWithApi(api.call, <NotificationsScreen tokenSource={{ getToken: () => Promise.resolve('t') }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/welcome/done'));
    expect(callsTo(api.call, 'POST', '/me/devices')).toHaveLength(1);
  });
});

describe('focus', () => {
  it('moves to the code field when Enter a Trade Code swaps it in', () => {
    markWelcomeArrived();
    render(<DoneScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter a Trade Code' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Trade Code'));
  });

  it('moves to Continue after a refusal, and the status region was already there to announce the note', async () => {
    stubNotification('default', 'denied');
    renderWithApi(api.call, <NotificationsScreen />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue' })),
    );
    expect(screen.getAllByRole('status')[0]).toBe(region);
    expect(region.textContent).toMatch(/blocked in your browser/i);
  });
});
