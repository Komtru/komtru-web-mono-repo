// @vitest-environment jsdom
// F-045 (SP-M04): security and devices. Two-step sign-in and its methods, backup codes, devices, and signing out elsewhere.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityScreen } from '../src/account/SecurityScreen';
import { expectNoAxeViolations } from './axe';
import { device, factor, paged, problem, recoverySheet, session } from './support/account';
import { SHELL_RULES, answerWith, callsTo, id, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const base = {
  'GET /me/mfa/factors': paged([]),
  'GET /me/devices': paged([device(1), device(2)]),
  'GET /me/sessions': paged([session(1), session(2)]),
};

describe('Security (SP-M04)', () => {
  it('says two-step is off and offers the setup, and lists the devices with this one marked', async () => {
    answerWith(api.call, base);
    const { container } = renderWithApi(api.call, <SecurityScreen />);
    expect(await screen.findByText('Off · add a second check on top of your password')).toBeDefined();
    expect(screen.getByText('iPhone 13 · This device')).toBeDefined();
    expect(screen.getByText('Active now')).toBeDefined();
    expect(screen.getAllByText('Samsung A52').length).toBeGreaterThan(0);
    // This device cannot be removed from itself; the other one can.
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(1);
    expect(screen.getByText(/Komtru will never ask for your PIN or a code/)).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the methods and the backup codes left when two-step is on, and locks the switch', async () => {
    answerWith(api.call, {
      ...base,
      'GET /me/mfa/factors': paged([factor(1), recoverySheet(6)]),
    });
    const { container } = renderWithApi(api.call, <SecurityScreen />);
    expect((await screen.findAllByText('Authenticator app')).length).toBeGreaterThan(0);
    expect(screen.getByText('6 left · each works once')).toBeDefined();
    const toggle = screen.getByRole('switch', { name: 'Two-step sign-in' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-readonly')).toBe('true');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('removes a method only after a code from the authenticator, and sends the proof it was given', async () => {
    const factors = [factor(1), recoverySheet()];
    answerWith(api.call, {
      ...base,
      'GET /me/mfa/factors': () => paged(factors),
      'POST /me/step-up': () => ({ stepUpToken: 'chal.secret', expiresAt: 1 }),
      'DELETE /me/mfa/factors/:id': () => {
        factors.splice(0, 2);
        return { ok: true };
      },
    });
    renderWithApi(api.call, <SecurityScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Remove\s*Authenticator app/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    const digits = within(dialog).getAllByRole('textbox');
    '123456'
      .split('')
      .forEach((d, i) => fireEvent.change(digits[i] as HTMLElement, { target: { value: d } }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(callsTo(api.call, 'DELETE', '/me/mfa/factors/:id')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/me/step-up')[0]?.body).toEqual({
      factorId: factor(1).id,
      code: '123456',
    });
    expect(callsTo(api.call, 'DELETE', '/me/mfa/factors/:id')[0]).toMatchObject({
      params: { id: factor(1).id },
      body: { stepUpToken: 'chal.secret' },
    });
    expect(await screen.findByText(/Off · add a second check/)).toBeDefined();
  });

  it('says a wrong code is wrong and keeps the sheet open', async () => {
    answerWith(api.call, {
      ...base,
      'GET /me/mfa/factors': paged([factor(1)]),
      'POST /me/step-up': problem('OTP_INVALID', 401, { attemptsRemaining: 2 }),
    });
    renderWithApi(api.call, <SecurityScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Remove\s*Authenticator app/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    const digits = within(dialog).getAllByRole('textbox');
    '000000'
      .split('')
      .forEach((d, i) => fireEvent.change(digits[i] as HTMLElement, { target: { value: d } }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText('That code isn’t right. 2 tries left.')).toBeDefined();
    expect(callsTo(api.call, 'DELETE', '/me/mfa/factors/:id')).toHaveLength(0);
  });

  it('shows new backup codes once after a step-up, and drops them when the person is done', async () => {
    answerWith(api.call, {
      ...base,
      'GET /me/mfa/factors': paged([factor(1), recoverySheet()]),
      'POST /me/step-up': { stepUpToken: 'chal.secret', expiresAt: 1 },
      'POST /me/mfa/recovery-codes': { recoveryCodes: ['7K2M-9PQX', '4RTS-VN31'] },
    });
    renderWithApi(api.call, <SecurityScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Get new codes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    const digits = within(dialog).getAllByRole('textbox');
    '123456'
      .split('')
      .forEach((d, i) => fireEvent.change(digits[i] as HTMLElement, { target: { value: d } }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('7K2M-9PQX')).toBeDefined();
    expect(screen.getByText('Shown once')).toBeDefined();
    expect(callsTo(api.call, 'POST', '/me/mfa/recovery-codes')[0]?.body).toEqual({
      stepUpToken: 'chal.secret',
    });
    fireEvent.click(screen.getByRole('button', { name: 'I’ve saved these codes' }));
    expect(screen.queryByText('7K2M-9PQX')).toBeNull();
  });

  it('signs out of every other session, and not this one', async () => {
    answerWith(api.call, {
      ...base,
      'GET /me/sessions': paged([session(1), session(2), session(3)]),
      'DELETE /me/sessions/:id': { ok: true },
    });
    renderWithApi(api.call, <SecurityScreen />);
    expect(await screen.findByText('Also signed in on 2 other devices.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of other devices' }));
    await waitFor(() => expect(callsTo(api.call, 'DELETE', '/me/sessions/:id')).toHaveLength(2));
    expect(callsTo(api.call, 'DELETE', '/me/sessions/:id').map((c) => c.params?.id)).toEqual([
      id(302),
      id(303),
    ]);
    expect(await screen.findByText('Signed out everywhere else.')).toBeDefined();
  });

  it('has nothing to sign out of when this is the only session, and no devices is an empty state', async () => {
    answerWith(api.call, {
      ...base,
      'GET /me/devices': paged([]),
      'GET /me/sessions': paged([session(1)]),
    });
    renderWithApi(api.call, <SecurityScreen />);
    expect(await screen.findByText('No devices yet')).toBeDefined();
    expect(screen.getByText('You’re only signed in here.')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Sign out of other devices' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows a loading state, then an error with a retry that asks again', async () => {
    answerWith(api.call, { ...base, 'GET /me/devices': new Error('boom') });
    renderWithApi(api.call, <SecurityScreen />);
    expect(screen.getByRole('status', { name: 'Loading your security settings' })).toBeDefined();
    expect(await screen.findByText('Couldn’t load your security settings')).toBeDefined();
    const before = callsTo(api.call, 'GET', '/me/devices').length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(callsTo(api.call, 'GET', '/me/devices').length).toBeGreaterThan(before));
  });

  it('says it is offline when the read fails with no network', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    answerWith(api.call, { ...base, 'GET /me/devices': new Error('offline') });
    renderWithApi(api.call, <SecurityScreen />);
    expect(await screen.findByText('You’re offline')).toBeDefined();
    expect(screen.getByText(/Reconnect to see your security settings/)).toBeDefined();
    online.mockRestore();
  });
});
