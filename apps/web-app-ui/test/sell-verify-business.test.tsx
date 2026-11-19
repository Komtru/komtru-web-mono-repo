// @vitest-environment jsdom
// T-121 (SO3): "Business Verification". The CAC number and the three documents a merchant application needs.
import type * as ApiClient from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellVerifyBusiness } from '../src/sell/VerifyBusiness';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, callsTo, renderWithApi, type CallFn } from './support/trade';
import { DOC, allDocuments, application } from './support/merchant';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>(), upload: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@komtru/api-client', async (original) => ({
  ...(await original<typeof ApiClient>()),
  uploadFile: api.upload,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: nav.push }) }));

const base = { 'GET /merchant/applications/me': application() };

const attach = (container: HTMLElement, label: string, name = 'doc.pdf') => {
  const section = screen.getByRole('region', { name: label });
  const input = section.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type: 'application/pdf' })] } });
  return container;
};

beforeEach(() => {
  api.call.mockReset();
  api.upload.mockReset();
  nav.push.mockReset();
});
afterEach(cleanup);

describe('Business verification (SO3)', () => {
  it('draws the CAC number, the three uploads and the required-documents note', async () => {
    answerWith(api.call, base);
    const { container } = renderWithApi(api.call, <SellVerifyBusiness />);
    expect(await screen.findByLabelText('CAC registration number')).toBeDefined();
    expect(screen.getByText('Proof of registration')).toBeDefined();
    expect(screen.getByRole('region', { name: 'CAC certificate' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'CAC status report or memorandum' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Proprietor or director ID' })).toBeDefined();
    expect(screen.getByText(/All three are required before you can send your application/)).toBeDefined();
    expect(screen.getByText('3 / 5')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('keeps Continue disabled until the CAC number and all three documents are attached', async () => {
    api.upload
      .mockResolvedValueOnce(DOC.cac)
      .mockResolvedValueOnce(DOC.status)
      .mockResolvedValueOnce(DOC.director);
    answerWith(api.call, base);
    const { container } = renderWithApi(api.call, <SellVerifyBusiness />);
    await screen.findByLabelText('CAC registration number');
    const cont = screen.getByRole<HTMLButtonElement>('button', { name: 'Continue to payout account' });
    fireEvent.change(screen.getByLabelText('CAC registration number'), { target: { value: 'RC 1487XXX' } });
    expect(cont.disabled).toBe(true);
    attach(container, 'CAC certificate');
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1));
    expect(api.upload.mock.calls[0]?.[2]).toEqual({ category: 'KYC_DOCUMENT', visibility: 'PRIVATE_OWNER' });
    attach(container, 'CAC status report or memorandum');
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    expect(cont.disabled).toBe(true);
    attach(container, 'Proprietor or director ID');
    await waitFor(() => expect(cont.disabled).toBe(false));
  });

  it('saves the CAC number, the business type and the documents, then moves on to payout', async () => {
    api.upload
      .mockResolvedValueOnce(DOC.cac)
      .mockResolvedValueOnce(DOC.status)
      .mockResolvedValueOnce(DOC.director);
    answerWith(api.call, {
      ...base,
      'PUT /merchant/applications/me': application({ documents: allDocuments }),
    });
    const { container } = renderWithApi(api.call, <SellVerifyBusiness />);
    await screen.findByLabelText('CAC registration number');
    fireEvent.change(screen.getByLabelText('CAC registration number'), { target: { value: ' RC 1487XXX ' } });
    attach(container, 'CAC certificate');
    attach(container, 'CAC status report or memorandum');
    attach(container, 'Proprietor or director ID');
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payout account' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/sell/payout'));
    expect(callsTo(api.call, 'PUT', '/merchant/applications/me')[0]?.body).toEqual({
      businessType: 'REGISTERED_BUSINESS',
      cacRcNumber: 'RC 1487XXX',
      documents: [
        { docType: 'CAC_CERTIFICATE', fileId: DOC.cac },
        { docType: 'STATUS_REPORT', fileId: DOC.status },
        { docType: 'DIRECTOR_ID', fileId: DOC.director },
      ],
    });
  });

  it('shows the documents already attached when the person comes back', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': application({
        form: { cacRcNumber: 'RC 1487XXX' },
        documents: allDocuments,
      }),
    });
    renderWithApi(api.call, <SellVerifyBusiness />);
    expect((await screen.findByLabelText<HTMLInputElement>('CAC registration number')).value).toBe(
      'RC 1487XXX',
    );
    const continueButton = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Continue to payout account',
    });
    expect(continueButton.disabled).toBe(false);
  });

  it('says a file that would not upload did not upload, and saves nothing', async () => {
    const { UploadError } = await vi.importActual<typeof ApiClient>('@komtru/api-client');
    api.upload.mockRejectedValue(new UploadError('x', 'UNREACHABLE'));
    answerWith(api.call, base);
    const { container } = renderWithApi(api.call, <SellVerifyBusiness />);
    await screen.findByLabelText('CAC registration number');
    attach(container, 'CAC certificate');
    expect(
      await screen.findByText('That file didn’t upload. Check your connection and try again.'),
    ).toBeDefined();
    expect(callsTo(api.call, 'PUT', '/merchant/applications/me')).toHaveLength(0);
  });

  it('says when the save did not go through and stays on the screen', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': application({
        form: { cacRcNumber: 'RC 1487XXX' },
        documents: allDocuments,
      }),
      'PUT /merchant/applications/me': problem('INTERNAL', 500),
    });
    renderWithApi(api.call, <SellVerifyBusiness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payout account' }));
    expect(
      await screen.findByText(
        'Couldn’t save your verification details. Check your connection and try again.',
      ),
    ).toBeDefined();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('shows a loading state, then a load failure with a retry', async () => {
    answerWith(api.call, { 'GET /merchant/applications/me': problem('INTERNAL', 500) });
    renderWithApi(api.call, <SellVerifyBusiness />);
    expect(await screen.findByText('Couldn’t load your application')).toBeDefined();
  });
});
