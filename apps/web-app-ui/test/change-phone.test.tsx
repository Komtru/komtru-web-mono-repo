// @vitest-environment jsdom
// F-045 (SP-M05): change phone number, as far as the platform allows today.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePhone, phoneDigits } from '../src/account/ChangePhone';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, callsTo, id, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

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
  it('draws the reference: both numbers, the three steps, and the lost-SIM note', () => {
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
    return expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says plainly that the codes cannot be sent yet, and does not offer a live "Send a code"', () => {
    renderWithApi(api.call, <ChangePhone />);
    expect(screen.getByText('Changing your number here isn’t available yet')).toBeDefined();
    const send = screen.getByRole('button', { name: 'Send a code' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(callsTo(api.call, 'POST', '/auth/recovery-requests')).toHaveLength(0);
  });

  it('checks each number as it is typed, and that the new one is a different number', () => {
    renderWithApi(api.call, <ChangePhone />);
    type('Current number', '0803 221');
    expect(screen.getByText('Enter it the way you use it, like 0803 221 4471.')).toBeDefined();
    type('Current number', '0803 221 4471');
    type('New number', '0803 221 4471');
    expect(screen.getByText('That’s the number you already have.')).toBeDefined();
  });

  it('opens a lost-phone recovery request with the current number when the person cannot get the code', async () => {
    answerWith(api.call, { 'POST /auth/recovery-requests': { receiptId: id(950), status: 'RECEIVED' } });
    renderWithApi(api.call, <ChangePhone />);
    const cant = screen.getByRole('button', { name: 'I can’t get the code' }) as HTMLButtonElement;
    expect(cant.disabled).toBe(true);
    type('Current number', '0803 221 4471');
    expect(cant.disabled).toBe(false);
    fireEvent.click(cant);
    expect(await screen.findByText('We’ve got your request')).toBeDefined();
    expect(callsTo(api.call, 'POST', '/auth/recovery-requests')[0]?.body).toEqual({
      identifier: '0803 221 4471',
      method: 'LOST_PHONE',
    });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'I can’t get the code' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it('says to wait when asked too often, and lets the person try again later', async () => {
    answerWith(api.call, { 'POST /auth/recovery-requests': problem('RATE_LIMITED', 429) });
    renderWithApi(api.call, <ChangePhone />);
    type('Current number', '0803 221 4471');
    fireEvent.click(screen.getByRole('button', { name: 'I can’t get the code' }));
    expect(await screen.findByText('Too many tries. Wait a minute and try again.')).toBeDefined();
    expect((screen.getByRole('button', { name: 'I can’t get the code' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
