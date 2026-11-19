// @vitest-environment jsdom
// F-045 (VF1): choosing which ID you actually hold, and whose name it is checked against.
//
// This file runs on the default jsdom host, `localhost`, which is not production — so the name
// fields are typeable here. `verification-name-lock.test.tsx` is the same screen on
// `app.komtru.com`, where they are not.
import type * as ApiClient from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Verification } from '../src/account/Verification';
import { me, rejection, status } from './support/account';
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

/** Walks the start branch as far as the form: the first screen is a "Verify your ID" button. */
const openStartForm = async () => {
  await screen.findByRole('button', { name: /verify your id/i });
  fireEvent.click(screen.getByRole('button', { name: /verify your id/i }));
  return screen.findByRole('radio', { name: /National Identity Number/ });
};

describe('Choosing NIN or BVN (VF1)', () => {
  it('asks which ID the person holds, and starts on NIN', async () => {
    answerWith(api.call, { ...base, 'GET /verification/status': status() });
    renderWithApi(api.call, <Verification />);
    const nin = await openStartForm();
    expect((nin as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Bank Verification Number/ }).checked).toBe(
      false,
    );
    // The number field is labelled for whichever one is selected, so nobody types a BVN into a
    // box that says NIN.
    expect(screen.getByLabelText('NIN')).toBeDefined();
    expect(screen.queryByLabelText('BVN')).toBeNull();
  });

  it('sends a BVN to the BVN endpoint once the person says that is what they have', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status(),
      'POST /verification/bvn': { requestId: id(901), status: 'SUBMITTED' },
    });
    renderWithApi(api.call, <Verification />);
    await openStartForm();
    fireEvent.click(screen.getByRole('radio', { name: /Bank Verification Number/ }));
    fireEvent.change(screen.getByLabelText('BVN'), { target: { value: '22233344455' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/verification/bvn')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/verification/nin')).toHaveLength(0);
    expect(callsTo(api.call, 'POST', '/verification/bvn')[0]?.body).toEqual({
      bvn: '22233344455',
      firstName: 'Chidi',
      lastName: 'Okafor',
    });
  });

  it('clears the number when the person switches which ID they are entering', async () => {
    // Eleven digits of a NIN silently re-sent as a BVN is a failed check and a spent provider
    // call, and the person would have no way to know why.
    answerWith(api.call, { ...base, 'GET /verification/status': status() });
    renderWithApi(api.call, <Verification />);
    await openStartForm();
    fireEvent.change(screen.getByLabelText('NIN'), { target: { value: '12345678901' } });
    fireEvent.click(screen.getByRole('radio', { name: /Bank Verification Number/ }));
    expect(screen.getByLabelText<HTMLInputElement>('BVN').value).toBe('');
  });

  it('opens on the check that failed, and still lets the person switch to the other one', async () => {
    // Somebody rejected on a NIN may well hold a BVN that does match. Pinning the form to the
    // failed type would make the second ID unreachable from the only screen that offers it.
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({
        rejections: [rejection('BVN', { code: 'ID_NAME_MISMATCH', remedy: 'RESUBMIT' })],
      }),
    });
    renderWithApi(api.call, <Verification />);
    await screen.findByRole('region', { name: 'Government-issued ID' });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Bank Verification Number/ }).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('radio', { name: /National Identity Number/ }));
    expect(screen.getByLabelText('NIN')).toBeDefined();
  });

  it('fills the name from the account and lets it be changed off the production host', async () => {
    answerWith(api.call, { ...base, 'GET /verification/status': status() });
    renderWithApi(api.call, <Verification />);
    await openStartForm();
    const first = screen.getByLabelText<HTMLInputElement>('First name');
    expect(first.value).toBe('Chidi');
    expect(first.disabled).toBe(false);
    fireEvent.change(first, { target: { value: 'Sarah' } });
    expect(screen.getByLabelText<HTMLInputElement>('First name').value).toBe('Sarah');
  });
});
