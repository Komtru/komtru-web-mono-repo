// @vitest-environment jsdom
// F-045 (SP-M05): change phone number, end to end through the three steps the platform now has.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePhone, phoneDigits } from '../src/account/ChangePhone';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, callsTo, id, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const assign = vi.fn();

beforeEach(() => {
  api.call.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true, configurable: true });
});
afterEach(cleanup);

const WHEN = '2026-11-17T10:00:00.000Z';
const STARTED = {
  changeId: id(700),
  challengeId: id(701),
  maskedDestination: '+23480•••4471',
  expiresAt: WHEN,
  delivered: true,
};
const SECOND = { challengeId: id(702), maskedDestination: '+23490•••2290', expiresAt: WHEN, delivered: true };

const FACTORS = { 'GET /me/mfa/factors': { items: [], page: 1, limit: 50, total: 0 } };
const STEP_UP = { 'POST /me/step-up': { stepUpToken: 'chal.secret', expiresAt: 1 } };

/** Names the number, gives the password as the proof the sheet asks for, and sends the first code. */
const sendFirst = async () => {
  type('New number', '0905 118 2290');
  const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send a code' });
  await waitFor(() => expect(send.disabled).toBe(false));
  fireEvent.click(send);
  const sheet = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
  fireEvent.change(within(sheet).getByLabelText('Your password'), { target: { value: 'hunter2hunter2' } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Confirm' }));
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const typeCode = (code: string) => {
  const cells = screen.getAllByRole('textbox');
  code
    .split('')
    .forEach((digit, index) => fireEvent.change(cells[index] as HTMLElement, { target: { value: digit } }));
};

describe('phoneDigits', () => {
  it('reads a Nigerian number as people write it, and refuses what is not one', () => {
    expect(phoneDigits('0803 221 4471')).toBe('08032214471');
    expect(phoneDigits('+234 803 221 4471')).toBe('2348032214471');
    expect(phoneDigits('0803-221-4471')).toBe('08032214471');
    expect(phoneDigits('803 221 4471')).toBeUndefined();
    expect(phoneDigits('0803 221')).toBeUndefined();
    expect(phoneDigits('')).toBeUndefined();
  });
});

describe('Change phone number (SP-M05)', () => {
  it('draws the reference: the new number, the three steps and the lost-SIM note', async () => {
    const { container } = renderWithApi(api.call, <ChangePhone />);
    expect(screen.getByRole('heading', { name: 'Move to a new number' })).toBeDefined();
    expect(
      screen.getByText('Your phone number is how others find you on Komtru, so we check both numbers.'),
    ).toBeDefined();
    const steps = screen.getByRole('list', { name: 'How the move works' });
    expect(steps.textContent).toContain('Code to your current number');
    expect(steps.textContent).toContain('Code to your new number');
    expect(steps.textContent).toContain('We tell your old number');
    expect(screen.getByText(/No longer have your old SIM\?/)).toBeDefined();
    // The platform has the current number: the person is not asked to type it.
    expect(screen.queryByLabelText('Current number')).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('holds "Send a code" until the new number looks like one', async () => {
    answerWith(api.call, FACTORS);
    renderWithApi(api.call, <ChangePhone />);
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send a code' });
    expect(send.disabled).toBe(true);
    type('New number', '0905 118');
    expect(screen.getByText('Enter it the way you use it, like 0905 118 2290.')).toBeDefined();
    expect(send.disabled).toBe(true);
    type('New number', '0905 118 2290');
    await waitFor(() => expect(send.disabled).toBe(false));
  });

  it('asks for proof it is you before anything is sent, and sends the proof with the number', async () => {
    answerWith(api.call, { ...FACTORS, ...STEP_UP, 'POST /me/phone/change': STARTED });
    renderWithApi(api.call, <ChangePhone />);
    type('New number', '0905 118 2290');
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send a code' });
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(callsTo(api.call, 'POST', '/me/phone/change')).toHaveLength(0);
    const sheet = screen.getByRole('dialog', { name: 'Confirm it’s you' });
    fireEvent.change(within(sheet).getByLabelText('Your password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirm' }));
    await screen.findByText(/We sent a code to your current number/);
    expect(callsTo(api.call, 'POST', '/me/phone/change')[0]?.body).toEqual({
      newPhone: '0905 118 2290',
      stepUpToken: 'chal.secret',
    });
  });

  it('uses the authenticator code as the proof when the account has one', async () => {
    answerWith(api.call, {
      'GET /me/mfa/factors': {
        items: [
          {
            id: id(800),
            type: 'TOTP',
            label: 'Authenticator app',
            isDefault: true,
            createdAt: WHEN,
            lastUsedAt: null,
          },
        ],
        page: 1,
        limit: 50,
        total: 1,
      },
      ...STEP_UP,
      'POST /me/phone/change': STARTED,
    });
    renderWithApi(api.call, <ChangePhone />);
    type('New number', '0905 118 2290');
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send a code' });
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    const sheet = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(within(sheet).queryByLabelText('Your password')).toBeNull();
    expect(within(sheet).getByText(/code from your authenticator app/)).toBeDefined();
  });

  it('goes through both codes and says the number is changed and the old one told', async () => {
    answerWith(api.call, {
      ...FACTORS,
      ...STEP_UP,
      'POST /me/phone/change': STARTED,
      'POST /me/phone/change/confirm-current': SECOND,
      'POST /me/phone/change/confirm-new': { status: 'CHANGED', maskedPhone: '+23490•••2290' },
    });
    const { container } = renderWithApi(api.call, <ChangePhone />);
    await sendFirst();
    expect(await screen.findByText(/We sent a code to your current number, \+23480•••4471/)).toBeDefined();
    expect(callsTo(api.call, 'POST', '/me/phone/change')[0]?.body).toEqual({
      newPhone: '0905 118 2290',
      stepUpToken: 'chal.secret',
    });

    typeCode('111111');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Now we sent a code to your new number, \+23490•••2290/)).toBeDefined();
    expect(callsTo(api.call, 'POST', '/me/phone/change/confirm-current')[0]?.body).toEqual({
      changeId: STARTED.changeId,
      challengeId: STARTED.challengeId,
      code: '111111',
    });
    await expectNoAxeViolations(container, SHELL_RULES);

    typeCode('222222');
    fireEvent.click(screen.getByRole('button', { name: 'Change my number' }));
    expect(await screen.findByText('Your number is changed')).toBeDefined();
    expect(
      screen.getByText(/Your number is now \+23490•••2290\. We’ve told your old number\./),
    ).toBeDefined();
    // The second step is carried by the NEW challenge, with the same change.
    expect(callsTo(api.call, 'POST', '/me/phone/change/confirm-new')[0]?.body).toEqual({
      changeId: STARTED.changeId,
      challengeId: SECOND.challengeId,
      code: '222222',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(assign).toHaveBeenCalledWith('/account/security');
  });

  it('says a wrong code is wrong and lets the person try again', async () => {
    answerWith(api.call, {
      ...FACTORS,
      ...STEP_UP,
      'POST /me/phone/change': STARTED,
      'POST /me/phone/change/confirm-current': problem('OTP_INVALID', 422, { attemptsRemaining: 4 }),
    });
    renderWithApi(api.call, <ChangePhone />);
    await sendFirst();
    await screen.findByText(/We sent a code to your current number/);
    typeCode('000000');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('That code isn’t right. 4 tries left.')).toBeDefined();
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('');
  });

  it('says so when the new number is already on another account', async () => {
    answerWith(api.call, {
      ...FACTORS,
      ...STEP_UP,
      'POST /me/phone/change': STARTED,
      'POST /me/phone/change/confirm-current': SECOND,
      'POST /me/phone/change/confirm-new': problem('CONFLICT', 409, {
        detail: 'It is already in use on another account. Start again with a different number.',
      }),
    });
    renderWithApi(api.call, <ChangePhone />);
    await sendFirst();
    await screen.findByText(/We sent a code to your current number/);
    typeCode('111111');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/Now we sent a code to your new number/);
    typeCode('222222');
    fireEvent.click(screen.getByRole('button', { name: 'Change my number' }));
    expect(await screen.findByText(/already in use on another account/)).toBeDefined();
  });

  it('says a number the platform refuses cannot be used, and an unreachable platform is not that', async () => {
    answerWith(api.call, {
      ...FACTORS,
      ...STEP_UP,
      'POST /me/phone/change': problem('VALIDATION_FAILED', 422),
    });
    renderWithApi(api.call, <ChangePhone />);
    await sendFirst();
    expect(await screen.findByText('That number can’t be used. Check it and try again.')).toBeDefined();
  });

  it('offers the lost-phone request as the way back in, labelled as that, and not as the change', async () => {
    answerWith(api.call, {
      ...FACTORS,
      'POST /auth/recovery-requests': { receiptId: id(950), status: 'RECEIVED' },
    });
    renderWithApi(api.call, <ChangePhone />);
    expect(screen.queryByRole('button', { name: 'I can’t get the code' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I’ve lost access to my number' }));
    expect(screen.getByText(/It doesn’t change your number: a person checks your ID first\./)).toBeDefined();
    const ask = screen.getByRole<HTMLButtonElement>('button', { name: 'Ask for help getting back in' });
    expect(ask.disabled).toBe(true);
    type('The number you’ve lost', '0803 221 4471');
    fireEvent.click(ask);
    expect(await screen.findByText('We’ve got your request')).toBeDefined();
    expect(callsTo(api.call, 'POST', '/auth/recovery-requests')[0]?.body).toEqual({
      identifier: '0803 221 4471',
      method: 'LOST_PHONE',
    });
  });

  it('words a rate-limited recovery request as that, not as a failed confirmation', async () => {
    answerWith(api.call, { ...FACTORS, 'POST /auth/recovery-requests': problem('RATE_LIMITED', 429) });
    renderWithApi(api.call, <ChangePhone />);
    fireEvent.click(screen.getByRole('button', { name: 'I’ve lost access to my number' }));
    type('The number you’ve lost', '0803 221 4471');
    fireEvent.click(screen.getByRole('button', { name: 'Ask for help getting back in' }));
    expect(await screen.findByText('You’ve asked too many times. Try again in an hour.')).toBeDefined();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Ask for help getting back in' }).disabled,
      ).toBe(false),
    );
    expect(screen.queryByText(/confirm it’s you/)).toBeNull();
  });
});
