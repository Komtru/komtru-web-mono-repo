// @vitest-environment jsdom
// F-045 (CA1, CA2): close your account. The check first, then the step that cannot be undone.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseAccount } from '../src/account/CloseAccount';
import { expectNoAxeViolations } from './axe';
import { factor, me, paged, problem } from './support/account';
import { SHELL_RULES, answerWith, callsTo, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const session = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/entry/session-calls', () => ({ signOut: session.signOut }));
const assign = vi.fn();

beforeEach(() => {
  api.call.mockReset();
  session.signOut.mockClear();
  assign.mockReset();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true, configurable: true });
});
afterEach(cleanup);

const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Close my account' }));
  return screen.findByRole('dialog', { name: 'This can’t be undone' });
};

describe('Close your account (CA1)', () => {
  it('is blocked by a trade in progress, says so before anything is typed, and sends the person to their Trades', async () => {
    answerWith(api.call, {
      'GET /me': me({ openTrades: true, canClose: false }),
      'GET /me/mfa/factors': paged([]),
    });
    const { container } = renderWithApi(api.call, <CloseAccount />);
    expect(await screen.findByText('Can’t close with an active Trade')).toBeDefined();
    expect(screen.getByText('You have a Trade still in progress — finish or cancel it first.')).toBeDefined();
    expect(screen.getByText('Preserved per regulatory requirement')).toBeDefined();
    expect(screen.getByText('Kept, not visible to you')).toBeDefined();
    expect(screen.getByText('Can’t be reused for 90 days')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Resolve your active Trade first' }).getAttribute('href')).toBe(
      '/trades',
    );
    expect(screen.queryByRole('button', { name: 'Close my account' })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('offers the close when nothing is in progress', async () => {
    answerWith(api.call, { 'GET /me': me(), 'GET /me/mfa/factors': paged([]) });
    const { container } = renderWithApi(api.call, <CloseAccount />);
    expect(await screen.findByRole('button', { name: 'Close my account' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Why are you leaving? (optional)' })).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows a loading state and then an error with a retry, and says when it is offline', async () => {
    answerWith(api.call, { 'GET /me': new Error('down'), 'GET /me/mfa/factors': paged([]) });
    renderWithApi(api.call, <CloseAccount />);
    expect(screen.getByRole('status', { name: 'Checking your account' })).toBeDefined();
    expect(await screen.findByText('Couldn’t load your account')).toBeDefined();
    cleanup();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithApi(api.call, <CloseAccount />);
    expect(await screen.findByText('You’re offline')).toBeDefined();
    online.mockRestore();
  });

  it('says an already closed account is closed', async () => {
    answerWith(api.call, { 'GET /me': me({ status: 'CLOSED' }), 'GET /me/mfa/factors': paged([]) });
    renderWithApi(api.call, <CloseAccount />);
    expect(await screen.findByText('This account is already closed.')).toBeDefined();
  });
});

describe('Confirm closure (CA2)', () => {
  it('holds the button until the box is ticked and the password given, then closes, signs out and says so', async () => {
    answerWith(api.call, {
      'GET /me': me(),
      'GET /me/mfa/factors': paged([]),
      'POST /me/close': { status: 'CLOSED', sessionsRevoked: 3 },
    });
    renderWithApi(api.call, <CloseAccount />);
    const sheet = await open();
    expect(
      within(sheet).getByText(
        'You’ll lose access immediately — your Trust History stays on record but is no longer visible to you.',
      ),
    ).toBeDefined();
    const confirm = within(sheet).getByRole('button', { name: 'Close my account' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Your password'), { target: { value: 'hunter2hunter2' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(
      within(sheet).getByRole('checkbox', { name: 'I understand this permanently closes my account.' }),
    );
    expect(confirm.disabled).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { hidden: true }), { target: { value: 'PRIVACY' } });
    fireEvent.click(confirm);
    expect(await screen.findByText('Your account is closed')).toBeDefined();
    expect(callsTo(api.call, 'POST', '/me/close')[0]?.body).toEqual({
      reason: 'PRIVACY',
      password: 'hunter2hunter2',
    });
    expect(session.signOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('says a wrong password is wrong and does not close', async () => {
    answerWith(api.call, {
      'GET /me': me(),
      'GET /me/mfa/factors': paged([]),
      'POST /me/close': problem('INVALID_CREDENTIALS', 401),
    });
    renderWithApi(api.call, <CloseAccount />);
    const sheet = await open();
    fireEvent.change(within(sheet).getByLabelText('Your password'), { target: { value: 'wrong' } });
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close my account' }));
    expect(await within(sheet).findByText('That password isn’t right.')).toBeDefined();
    expect(session.signOut).not.toHaveBeenCalled();
  });

  it('turns to the blocked screen when the platform finds a trade the screen did not know about', async () => {
    answerWith(api.call, {
      'GET /me': me({ openTrades: null }),
      'GET /me/mfa/factors': paged([]),
      'POST /me/close': problem('CONFLICT', 409, { reason: 'ACTIVE_TRADES' }),
    });
    renderWithApi(api.call, <CloseAccount />);
    const sheet = await open();
    fireEvent.change(within(sheet).getByLabelText('Your password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close my account' }));
    expect(await screen.findByText('Can’t close with an active Trade')).toBeDefined();
  });

  it('asks for a code instead when the account has no password, and closes with the proof it gets', async () => {
    let attempt = 0;
    answerWith(api.call, {
      'GET /me': me(),
      'GET /me/mfa/factors': paged([factor(1)]),
      'POST /me/close': () => {
        attempt += 1;
        return attempt === 1 ? problem('STEP_UP_REQUIRED', 403) : { status: 'CLOSED', sessionsRevoked: 1 };
      },
      'POST /me/step-up': { stepUpToken: 'chal.secret', expiresAt: 1 },
    });
    renderWithApi(api.call, <CloseAccount />);
    const sheet = await open();
    fireEvent.change(within(sheet).getByLabelText('Your password'), { target: { value: 'x' } });
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close my account' }));
    const proof = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    const cells = within(proof).getAllByRole('textbox');
    '123456'.split('').forEach((d, i) => fireEvent.change(cells[i] as HTMLElement, { target: { value: d } }));
    fireEvent.click(within(proof).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Your account is closed')).toBeDefined();
    expect(callsTo(api.call, 'POST', '/me/close')[1]?.body).toEqual({
      reason: 'OTHER',
      stepUpToken: 'chal.secret',
    });
  });
});

describe('Delete my data (the erasure request, which closes the account)', () => {
  it('says it closes the account first, and sends the request to the erasure route', async () => {
    answerWith(api.call, {
      'GET /me': me(),
      'GET /me/mfa/factors': paged([]),
      'POST /me/erasure-request': { status: 'CLOSED', scheduledFor: '2026-12-17T09:00:00.000Z' },
    });
    renderWithApi(api.call, <CloseAccount erase />);
    expect(await screen.findByText('This closes your account first')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close and delete my data' }));
    const sheet = await screen.findByRole('dialog', { name: 'This can’t be undone' });
    fireEvent.change(within(sheet).getByLabelText('Your password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close and delete my data' }));
    expect(await screen.findByText('Your request is in')).toBeDefined();
    expect(screen.getByText(/erased by 17 Dec/)).toBeDefined();
    await waitFor(() => expect(callsTo(api.call, 'POST', '/me/erasure-request')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/me/close')).toHaveLength(0);
  });
});
