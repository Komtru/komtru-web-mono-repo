// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://app.komtru.com/account/verification" }
//
// F-045 (VF1) on the production host: the name a NIN or BVN is matched against is the account's
// own, and the person cannot choose it.
//
// Why it matters: the provider answers "does this name match this number", so a person free to
// type any name beside any number can walk a stolen NIN through guesses until the national record
// agrees with them — turning an identity check into an identity lookup. On staging the fields stay
// typeable, because Youverify's sandbox IDs answer to fixed names no tester's account carries;
// `verification-id-choice.test.tsx` covers that side on `localhost`.
//
// This disables inputs. It is not the enforcement — `TRUST_ALLOW_NAME_OVERRIDE` on the API is,
// because a disabled input is a thing in a browser and the request behind it is not.
import type * as ApiClient from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Verification } from '../src/account/Verification';
import { me, status } from './support/account';
import { answerWith, callsTo, id, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>(), upload: vi.fn() }));
vi.mock('@komtru/api-client', async (original) => ({
  ...(await original<typeof ApiClient>()),
  uploadFile: api.upload,
}));

beforeEach(() => {
  api.call.mockReset();
  api.upload.mockReset();
});
afterEach(cleanup);

const base = { 'GET /me': me() };

const openStartForm = async () => {
  await screen.findByRole('button', { name: /verify your id/i });
  fireEvent.click(screen.getByRole('button', { name: /verify your id/i }));
  return screen.findByRole('radio', { name: /National Identity Number/ });
};

describe('The name on an ID claim, on the production host', () => {
  it('is the account’s own, shown and not editable', async () => {
    answerWith(api.call, { ...base, 'GET /verification/status': status() });
    renderWithApi(api.call, <Verification />);
    await openStartForm();
    const first = screen.getByLabelText<HTMLInputElement>('First name');
    const last = screen.getByLabelText<HTMLInputElement>('Last name');
    expect(first.value).toBe('Chidi');
    expect(last.value).toBe('Okafor');
    expect(first.disabled).toBe(true);
    expect(last.disabled).toBe(true);
  });

  it('says why the field cannot be changed, rather than greying it out in silence', async () => {
    answerWith(api.call, { ...base, 'GET /verification/status': status() });
    renderWithApi(api.call, <Verification />);
    await openStartForm();
    expect(screen.getByText(/the name on your account/i)).toBeDefined();
  });

  it('is what gets sent, and the person can still submit', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status(),
      'POST /verification/nin': { requestId: id(901), status: 'SUBMITTED' },
    });
    renderWithApi(api.call, <Verification />);
    await openStartForm();
    fireEvent.change(screen.getByLabelText('NIN'), { target: { value: '12345678901' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/verification/nin')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/verification/nin')[0]?.body).toEqual({
      nin: '12345678901',
      firstName: 'Chidi',
      lastName: 'Okafor',
    });
  });

  it('lets the person type when the account has no surname to lock to', async () => {
    // A one-word name at sign-up leaves `lastName` null. Locking an empty box would leave them
    // staring at a form they cannot complete and cannot fix — so this is the one case that opens
    // up, and the API's own rule opens up on exactly the same condition.
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({ nameClaim: { firstName: 'Chidi', lastName: null } }),
    });
    renderWithApi(api.call, <Verification />);
    await openStartForm();
    expect(screen.getByLabelText<HTMLInputElement>('First name').disabled).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>('Last name').disabled).toBe(false);
  });

  it('lets the person type when the API is too old to send a name at all', async () => {
    // The app can ship ahead of the API. Degrading to a typeable form is the only safe way to be
    // wrong here; degrading to a locked empty one would take the screen away entirely.
    const { nameClaim: _omitted, ...withoutName } = status() as Record<string, unknown>;
    answerWith(api.call, { ...base, 'GET /verification/status': withoutName });
    renderWithApi(api.call, <Verification />);
    await openStartForm();
    expect(screen.getByLabelText<HTMLInputElement>('First name').disabled).toBe(false);
  });
});
