// @vitest-environment jsdom
// F-028 / CWT-S09: Delivery - Waybill and Handover, self-arranged. Confirming ships the trade with the evidence.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Handover } from '../src/trade/delivery/Handover';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  id,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  );
});

const uploads = {
  'POST /files/upload-url': {
    fileId: id(55),
    cloudName: 'komtru',
    uploadUrl: 'https://upload.test/x',
    params: { signature: 's' },
    maxBytes: 5_000_000,
    expiresAt: '2026-11-11T12:00:00.000Z',
  },
  'POST /files/:id/finalize': { fileId: id(55), uploadState: 'PENDING' },
};
const serve = (trade: unknown, more: Record<string, unknown> = {}) => {
  answerWith(api.call, { 'GET /trades/:id': trade, ...uploads, ...more });
  return renderWithApi(api.call, <Handover id={id(1)} />);
};

const fill = (container: HTMLElement) => {
  fireEvent.change(screen.getByLabelText('Waybill number'), { target: { value: 'KT-883192' } });
  fireEvent.change(screen.getByLabelText('Driver or rider phone'), { target: { value: '08012345678' } });
  fireEvent.change(screen.getByLabelText('Vehicle registration plate'), { target: { value: 'lsr 123 ab' } });
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'receipt.jpg', { type: 'image/jpeg' })] },
  });
};
const confirm = () => screen.getByRole<HTMLButtonElement>('button', { name: /Confirm handover/ });

describe('CWT-S09 waybill and handover', () => {
  it('keeps Confirm handover shut until the evidence is given and the courier has the parcel', async () => {
    const { container } = serve(workspaceTrade('FUNDED', 'SELLER'));
    expect(
      await screen.findByText('Generate or review the waybill and confirm the courier handover.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Hand Over' })).toBeTruthy();
    expect(screen.queryByText(/Park|PIN/)).toBeNull();
    expect(confirm().disabled).toBe(true);
    fill(container);
    await waitFor(() => {
      expect(screen.getAllByText('receipt.jpg').length).toBeGreaterThan(0);
    });
    expect(confirm().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('The courier has collected the parcel'));
    expect(confirm().disabled).toBe(false);
    expect(screen.getByText('Waybill KT-883192')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe(`/trade/${id(1)}/dispatch`);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('ships once with the platform’s ids, however often it is pressed, and then points to tracking', async () => {
    const { container } = serve(workspaceTrade('FUNDED', 'SELLER'), {
      'POST /trades/:id/ship/self-arranged': workspaceTrade('SHIPPED', 'SELLER'),
    });
    await screen.findByLabelText('Waybill number');
    fill(container);
    fireEvent.click(screen.getByLabelText('The courier has collected the parcel'));
    await waitFor(() => {
      expect(confirm().disabled).toBe(false);
    });
    fireEvent.click(confirm());
    fireEvent.click(confirm());
    expect(await screen.findByRole('heading', { name: 'Handover confirmed' })).toBeTruthy();
    const sent = callsTo(api.call, 'POST', '/trades/:id/ship/self-arranged');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      waybillNumber: 'KT-883192',
      receiptFileId: id(55),
      driverPhone: '08012345678',
      vehiclePlate: 'LSR 123 AB',
    });
    expect(screen.getByRole('link', { name: 'Track the delivery' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/track`,
    );
  });

  it('says what the platform refused and keeps what was typed', async () => {
    const refusal = new ProblemError(
      {
        type: 'about:blank',
        title: 'x',
        status: 422,
        code: 'VALIDATION_FAILED',
        detail: 'Driver phone is not valid.',
      },
      { status: 422, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
      false,
    );
    const { container } = serve(workspaceTrade('FUNDED', 'SELLER'), {
      'POST /trades/:id/ship/self-arranged': refusal,
    });
    await screen.findByLabelText('Waybill number');
    fill(container);
    fireEvent.click(screen.getByLabelText('The courier has collected the parcel'));
    await waitFor(() => {
      expect(confirm().disabled).toBe(false);
    });
    fireEvent.click(confirm());
    expect(await screen.findByText(/Driver phone is not valid/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Waybill number').value).toBe('KT-883192');
  });

  it('locks handover before the payment is protected', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'SELLER'));
    expect(await screen.findByText('Dispatch locked')).toBeTruthy();
    expect(screen.queryByLabelText('Waybill number')).toBeNull();
  });

  it('refuses the buyer (permission denied) and shows loading and error states', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    expect(await screen.findByText(/Only the seller hands the item over/)).toBeTruthy();
    cleanup();
    answerWith(api.call, { 'GET /trades/:id': new Error('down') });
    renderWithApi(api.call, <Handover id={id(1)} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Couldn’t load this trade')).toBeTruthy();
  });
});
