// @vitest-environment jsdom
// F-044 (SP-M14 to SP-M19): the six system states, as screens. How each is reached is held by `system-reach.test.tsx`.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraPermission } from '../src/system/CameraPermission';
import { LinkNotFound } from '../src/system/LinkNotFound';
import { ServiceNotice } from '../src/system/ServiceNotice';
import { SessionExpired } from '../src/system/SessionExpired';
import { TooManyAttempts } from '../src/system/TooManyAttempts';
import { UpdateRequired } from '../src/system/UpdateRequired';
import { expectNoAxeViolations } from './axe';
import { me, problem } from './support/account';
import { SHELL_RULES, answerWith, page, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const cache = vi.hoisted(() => ({ clear: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/shell/ServiceWorker', () => ({ clearOfflineCache: cache.clear, ServiceWorker: () => null }));

const setOnline = (online: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });

beforeEach(() => {
  api.call.mockReset();
  cache.clear.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setOnline(true);
});

describe('Link expired or Trade not found (SP-M19)', () => {
  it('turns a dead link into a safety message, with a way to enter a code and a way to reach support', async () => {
    answerWith(api.call, { 'GET /me': me() });
    const { container } = renderWithApi(api.call, <LinkNotFound />);
    expect(screen.getByRole('heading', { name: 'We can’t find that Trade' })).toBeDefined();
    expect(
      screen.getByText('The code may be mistyped, or the Trade may have been cancelled or have expired.'),
    ).toBeDefined();
    expect(
      screen.getByText(
        'Komtru never asks you to pay from a link. Search the Trade Code inside the app instead.',
      ),
    ).toBeDefined();
    expect(screen.getByText(/sign in with the phone number or email they used/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Enter a Trade Code' }).getAttribute('href')).toBe('/find');
    fireEvent.click(await screen.findByRole('button', { name: 'Contact support' }));
    expect(await screen.findByText('SUP-7KQ2')).toBeDefined();
    // It never says whether the Trade exists, or whose it is.
    expect(container.textContent).not.toMatch(/forbidden|not yours|permission/i);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('still offers a way out when support’s reference cannot be read', async () => {
    answerWith(api.call, { 'GET /me': problem('INTERNAL', 500) });
    const { container } = renderWithApi(api.call, <LinkNotFound />);
    expect(screen.getByRole('link', { name: 'Enter a Trade Code' })).toBeDefined();
    await waitFor(() => expect(api.call).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Contact support' })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Too many attempts (SP-M17)', () => {
  it('says how long, why, and what to do instead, and counts down', async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const { container } = renderWithApi(api.call, <TooManyAttempts waitSeconds={90} onRetry={onRetry} />);
    expect(screen.getByRole('heading', { name: 'Too many tries' })).toBeDefined();
    expect(
      screen.getByText('To keep your account safe, sign-in is paused for a little while.'),
    ).toBeDefined();
    expect(screen.getByText('1:30')).toBeDefined();
    expect(
      screen.getByText(
        /Forgot your code or lost your phone\? You don’t need to wait: we can help you recover your account\./,
      ),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Recover my account' }).getAttribute('href')).toBe(
      '/reset-password',
    );
    const back = screen.getByRole<HTMLButtonElement>('button', { name: 'Back to log in' });
    expect(back.disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('1:00')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // axe needs the real clock.
    vi.useRealTimers();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows no clock when the platform gave no wait, rather than inventing one', async () => {
    const { container } = renderWithApi(
      api.call,
      <TooManyAttempts waitSeconds={undefined} onRetry={() => undefined} />,
    );
    expect(screen.queryByText(/^\d+:\d{2}$/)).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Back to log in' }).disabled).toBe(false);
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Session expired (SP-M16)', () => {
  it('explains the sign-out and takes one step back to where the person was', async () => {
    const { container } = renderWithApi(api.call, <SessionExpired next="/trades/KMT-1-NG" />);
    expect(screen.getByRole('heading', { name: 'Please sign in again' })).toBeDefined();
    expect(
      screen.getByText(
        'For your security we sign you out after a while, or when your account changes on another device.',
      ),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe(
      '/login?next=%2Ftrades%2FKMT-1-NG',
    );
    expect(screen.getByRole('link', { name: 'Use a different account' }).getAttribute('href')).toBe('/login');
    // The phone number is not kept on the device: it could be the last person's, on a shared phone.
    expect(screen.queryByRole('textbox')).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('goes to plain log in when there is nowhere to go back to', () => {
    renderWithApi(api.call, <SessionExpired next={undefined} />);
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login');
  });
});

describe('Update required (SP-M15)', () => {
  it('says money and Trades are unaffected, and Update now loads the newest version', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload }, writable: true, configurable: true });
    const { container } = renderWithApi(api.call, <UpdateRequired />);
    expect(screen.getByRole('heading', { name: 'Please update Komtru' })).toBeDefined();
    expect(
      screen.getByText(
        'This version is no longer supported. Your Trades and money are safe, and nothing changes until you update.',
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // The old version's saved pages go first, so the reload cannot hand back the same old one.
    expect(cache.clear).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('still reloads if the saved pages cannot be cleared', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload }, writable: true, configurable: true });
    cache.clear.mockRejectedValueOnce(new Error('no worker'));
    renderWithApi(api.call, <UpdateRequired />);
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('answers "Why am I seeing this?"', async () => {
    const { container } = renderWithApi(api.call, <UpdateRequired />);
    fireEvent.click(screen.getByRole('button', { name: 'Why am I seeing this?' }));
    expect(screen.getByText(/Komtru has changed in a way this version can’t follow/)).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Service notice (SP-M14)', () => {
  it('says all is well when the platform answers, and does not invent an incident', async () => {
    answerWith(api.call, { 'GET /geo/states': page([]) });
    const { container } = renderWithApi(api.call, <ServiceNotice />);
    expect(await screen.findByRole('heading', { name: 'Komtru is working' })).toBeDefined();
    expect(screen.getByText(/We couldn’t find a problem just now/)).toBeDefined();
    expect(screen.queryByText(/bank payments/i)).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says plainly what it means for you when the platform does not answer', async () => {
    answerWith(api.call, { 'GET /geo/states': problem('SERVICE_UNAVAILABLE', 503) });
    const { container } = renderWithApi(api.call, <ServiceNotice />);
    expect(await screen.findByRole('heading', { name: 'Komtru is having trouble' })).toBeDefined();
    expect(screen.getByText(/This isn’t caused by anything you did\./)).toBeDefined();
    expect(screen.getByText('If you’ve paid, please don’t pay again. Check the Trade first.')).toBeDefined();
    expect(screen.getByText(/Checked \d{2}:\d{2}/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Back to Trades' }).getAttribute('href')).toBe('/trades');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('checks again when asked', async () => {
    answerWith(api.call, { 'GET /geo/states': problem('SERVICE_UNAVAILABLE', 503) });
    renderWithApi(api.call, <ServiceNotice />);
    await screen.findByRole('heading', { name: 'Komtru is having trouble' });
    answerWith(api.call, { 'GET /geo/states': page([]) });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('heading', { name: 'Komtru is working' })).toBeDefined();
  });

  it('says it is the device, not Komtru, when there is no network', async () => {
    setOnline(false);
    answerWith(api.call, { 'GET /geo/states': new TypeError('Failed to fetch') });
    const { container } = renderWithApi(api.call, <ServiceNotice />);
    expect(await screen.findByRole('heading', { name: 'You’re offline' })).toBeDefined();
    expect(screen.getByText(/can’t tell whether Komtru is working/)).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows loading while it checks', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const { container } = renderWithApi(api.call, <ServiceNotice />);
    expect(screen.getByRole('status', { name: 'Checking Komtru' })).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Camera permission (SP-M18)', () => {
  it('asks just before it is needed, with the reason in the person’s terms, and two honest choices', async () => {
    const onAllow = vi.fn();
    const onNotNow = vi.fn();
    const { container } = renderWithApi(api.call, <CameraPermission onAllow={onAllow} onNotNow={onNotNow} />);
    expect(screen.getByRole('heading', { name: 'Allow the camera' })).toBeDefined();
    expect(
      screen.getByText('Photos you take in Komtru are marked as taken on your device, which buyers trust.'),
    ).toBeDefined();
    expect(screen.getByText('Used only to take photos for a Trade')).toBeDefined();
    expect(screen.getByText('You can also pick photos you took earlier')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Privacy & data' }).getAttribute('href')).toBe(
      '/account/privacy',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow the camera' }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onNotNow).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});
