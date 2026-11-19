// @vitest-environment jsdom
// F-045 (VF1): a verification that did not pass, why, and how to try again.
import type * as ApiClient from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Verification, activeRejections } from '../src/account/Verification';
import { expectNoAxeViolations } from './axe';
import { me, problem, rejection, status } from './support/account';
import { SHELL_RULES, answerWith, callsTo, id, renderWithApi, type CallFn } from './support/trade';

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

const WHEN = '2026-11-14T10:00:00.000Z';
const LATER = '2026-11-15T10:00:00.000Z';
const base = { 'GET /me': me() };

describe('Verification failed (VF1)', () => {
  it('offers merchant verification from the Verifications tab', async () => {
    answerWith(api.call, { ...base, 'GET /verification/status': status() });
    renderWithApi(api.call, <Verification />);
    const entry = await screen.findByRole('link', { name: /^Merchant verification/ });
    expect(entry.getAttribute('href')).toBe('/account/verification/merchant');
  });

  it('shows what failed, the platform’s own reason and copy, and the way to try again', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({ rejections: [rejection('LIVENESS')] }),
    });
    const { container } = renderWithApi(api.call, <Verification />);
    expect(await screen.findByRole('region', { name: 'Selfie check' })).toBeDefined();
    expect(screen.getByText('Couldn’t be verified')).toBeDefined();
    expect(screen.getByText('Failed')).toBeDefined();
    expect(screen.getByText('Why this usually happens')).toBeDefined();
    expect(screen.getByText(/A blurry photo or glare across the ID is the usual cause/)).toBeDefined();
    expect(screen.getByText('Upload a clearer photo')).toBeDefined();
    expect(screen.getByText('Flat surface, good light, all four corners visible')).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Resubmit' }).disabled).toBe(true);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('uploads the clearer photo as the person’s own KYC document and submits it for the liveness check', async () => {
    api.upload.mockResolvedValue(id(900));
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({ rejections: [rejection('LIVENESS')] }),
      'POST /verification/liveness': { requestId: id(901), status: 'SUBMITTED' },
    });
    const { container } = renderWithApi(api.call, <Verification />);
    await screen.findByText('Upload a clearer photo');
    const file = new File(['x'], 'selfie.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/verification/liveness')).toHaveLength(1));
    expect(api.upload.mock.calls[0]?.[1]).toBe(file);
    expect(api.upload.mock.calls[0]?.[2]).toEqual({ category: 'KYC_DOCUMENT', visibility: 'PRIVATE_OWNER' });
    expect(callsTo(api.call, 'POST', '/verification/liveness')[0]?.body).toEqual({ selfieFileId: id(900) });
  });

  it('says a photo that would not upload did not upload, and sends nothing', async () => {
    const { UploadError } = await vi.importActual<typeof ApiClient>('@komtru/api-client');
    api.upload.mockRejectedValue(new UploadError('x', 'UNREACHABLE'));
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({ rejections: [rejection('LIVENESS')] }),
    });
    const { container } = renderWithApi(api.call, <Verification />);
    await screen.findByText('Upload a clearer photo');
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'selfie.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    expect(
      await screen.findByText('That photo didn’t upload. Check your connection and try again.'),
    ).toBeDefined();
    expect(callsTo(api.call, 'POST', '/verification/liveness')).toHaveLength(0);
  });

  it('resubmits a failed NIN with the number and the name on it', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({
        rejections: [rejection('NIN', { code: 'ID_NAME_MISMATCH', remedy: 'RESUBMIT' })],
      }),
      'POST /verification/nin': { requestId: id(902), status: 'SUBMITTED' },
    });
    const { container } = renderWithApi(api.call, <Verification />);
    expect(await screen.findByRole('region', { name: 'Government-issued ID' })).toBeDefined();
    fireEvent.change(screen.getByLabelText('NIN'), { target: { value: '123 4567 8901' } });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Amaka' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Balogun' } });
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/verification/nin')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/verification/nin')[0]?.body).toEqual({
      nin: '12345678901',
      firstName: 'Amaka',
      lastName: 'Balogun',
    });
  });

  it('tells the person to confirm their contact details first when the platform asks for that', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({ rejections: [rejection('BVN', { remedy: 'RESUBMIT' })] }),
      'POST /verification/bvn': problem('CONTACT_VERIFICATION_REQUIRED'),
    });
    renderWithApi(api.call, <Verification />);
    await screen.findByRole('region', { name: 'Government-issued ID' });
    fireEvent.change(screen.getByLabelText('BVN'), { target: { value: '12345678901' } });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Amaka' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Balogun' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    expect(
      await screen.findByText('Confirm your email and phone number first, then send this again.'),
    ).toBeDefined();
  });

  it('shows the support reference from the account, with the reference to quote', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({ rejections: [rejection('LIVENESS')] }),
    });
    renderWithApi(api.call, <Verification />);
    const button = await screen.findByRole('button', { name: 'Contact support instead' });
    await waitFor(() => expect(callsTo(api.call, 'GET', '/me')).toHaveLength(1));
    fireEvent.click(button);
    expect(await screen.findByText('SUP-7KQ2')).toBeDefined();
  });

  it('does not offer a resubmit for a business check, which another screen owns, but still says why', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({
        rejections: [
          rejection('CAC', {
            code: 'CAC_NOT_FOUND',
            surface: 'BVR1',
            outcome: 'REJECTED',
            whyHeading: 'Why',
            why: 'The CAC number submitted doesn’t match any active registration on file.',
            remedy: 'RESUBMIT',
            identityLevelAffected: false,
          }),
        ],
      }),
    });
    renderWithApi(api.call, <Verification />);
    expect(await screen.findByText('Business registration')).toBeDefined();
    expect(screen.getByText('Not approved')).toBeDefined();
    expect(screen.getByText(/doesn’t match any active registration/)).toBeDefined();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('offers no NIN form for a check that is not an ID check, even when the platform says to resubmit', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({
        rejections: [
          rejection('DOCUMENT', { remedy: 'RESUBMIT' }),
          rejection('ADDRESS', { remedy: 'RESUBMIT' }),
        ],
      }),
    });
    renderWithApi(api.call, <Verification />);
    expect(await screen.findByRole('region', { name: 'Document' })).toBeDefined();
    expect(screen.queryByLabelText('NIN')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resubmit' })).toBeNull();
  });

  it('shows a newer attempt as being checked and drops the failure it replaces', () => {
    const current = status({
      rejections: [rejection('LIVENESS')],
      inFlight: [
        {
          requestId: id(903),
          type: 'LIVENESS',
          status: 'PROVIDER_PENDING',
          submittedAt: LATER,
          expiresAt: LATER,
        },
      ],
    });
    expect(activeRejections(current)).toEqual([]);
    const older = status({
      rejections: [rejection('LIVENESS')],
      inFlight: [
        {
          requestId: id(903),
          type: 'LIVENESS',
          status: 'PROVIDER_PENDING',
          submittedAt: '2026-11-13T10:00:00.000Z',
          expiresAt: LATER,
        },
      ],
    });
    expect(activeRejections(older)).toHaveLength(1);
    expect(WHEN < LATER).toBe(true);
  });

  it('says it is checking, with nothing to fix, while a request is in flight', async () => {
    answerWith(api.call, {
      ...base,
      'GET /verification/status': status({
        inFlight: [
          {
            requestId: id(903),
            type: 'NIN',
            status: 'PROVIDER_PENDING',
            submittedAt: LATER,
            expiresAt: LATER,
          },
        ],
      }),
    });
    renderWithApi(api.call, <Verification />);
    expect(await screen.findByText('We’re checking')).toBeDefined();
    expect(screen.getByText(/Government-issued ID — we’ll tell you the moment/)).toBeDefined();
  });

  it('has an empty state when nothing has failed', async () => {
    answerWith(api.call, { ...base, 'GET /verification/status': status() });
    renderWithApi(api.call, <Verification />);
    expect(await screen.findByText('Nothing to fix')).toBeDefined();
    expect(screen.getByText('What’s needed')).toBeDefined();
  });

  it('shows loading, then an error with a retry, then offline', async () => {
    answerWith(api.call, { ...base, 'GET /verification/status': new Error('down') });
    renderWithApi(api.call, <Verification />);
    expect(screen.getByRole('status', { name: 'Loading your verification' })).toBeDefined();
    expect(await screen.findByText('Couldn’t load your verification')).toBeDefined();
    cleanup();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithApi(api.call, <Verification />);
    expect(await screen.findByText('You’re offline')).toBeDefined();
    online.mockRestore();
  });
});
