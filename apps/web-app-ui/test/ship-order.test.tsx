// @vitest-environment jsdom
// F-026: Ship Order (Seller-3), its locked state (X1) and the evidence form (X2). Which options exist is the
// platform's answer; the form here is the self-arranged branch, the only one that works without Park or a company.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipOrder } from '../src/trade/shipping/ShipOrder';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  deliveryDeadline,
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

const problem = (code: string, httpStatus: number, detail?: string) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded', status: httpStatus, code, ...(detail ? { detail } : {}) },
    {
      status: httpStatus,
      requestId: undefined,
      replayed: false,
      retryAfterMs: undefined,
      rateLimit: undefined,
    },
    false,
  );

const OPTIONS = {
  tradeId: id(1),
  tradeCode: 'KMT-9042800-NG',
  options: [
    {
      kind: 'PARK',
      label: 'Park Hub Transit',
      available: false,
      reason: { code: 'PARK_NOT_AVAILABLE_IN_CITY', message: "Park isn't available in Ikeja yet" },
    },
    {
      kind: 'SELF_ARRANGED',
      label: 'Arrange my own shipping',
      available: true,
      requiredFields: ['waybillNumber', 'receiptFileId', 'driverPhone', 'vehiclePlate'],
    },
  ],
};

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

const serve = (trade: unknown, more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/ship-options': OPTIONS,
    'GET /trades/:id/delivery-deadline': deliveryDeadline(),
    ...uploads,
    ...more,
  });

const show = () => renderWithApi(api.call, <ShipOrder id={id(1)} />);

const fill = (container: HTMLElement) => {
  fireEvent.change(screen.getByLabelText('Waybill number'), { target: { value: 'KT-883192' } });
  fireEvent.change(screen.getByLabelText('Driver or rider phone'), { target: { value: '08012345678' } });
  fireEvent.change(screen.getByLabelText('Vehicle registration plate'), { target: { value: 'lsr 123 ab' } });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: { files: [new File(['x'], 'receipt.jpg', { type: 'image/jpeg' })] },
  });
};

describe('X1: dispatch locked until escrow is funded', () => {
  it('says the buyer has not funded it, locks dispatch and never asks the platform for options', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'SELLER'));
    const { container } = show();
    expect(await screen.findByText(/Dispatch Locked/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'KMT-9042800-NG' })).toBeTruthy();
    expect(screen.getByText(/Amaka B\. hasn’t funded this trade yet/)).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Where this trade stands' });
    expect(within(steps).getByText('Agreement reached')).toBeTruthy();
    expect(within(steps).getByText('Not yet funded')).toBeTruthy();
    expect(within(steps).getByText('Locked until funded')).toBeTruthy();
    const locked = screen.getByRole<HTMLButtonElement>('button', { name: 'Dispatch locked' });
    expect(locked.disabled).toBe(true);
    expect(callsTo(api.call, 'GET', '/trades/:id/ship-options')).toHaveLength(0);
    expect(screen.queryByLabelText('Waybill number')).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('Seller-3 and X2: ship it yourself, with proof', () => {
  it('asks for the four pieces of evidence, offers no Park, and keeps Mark as shipped shut until all are given', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    const { container } = show();
    expect(await screen.findByLabelText('Waybill number')).toBeTruthy();
    expect(screen.getByText('Funds are protected. Ship to release them to you.')).toBeTruthy();
    expect(screen.getByText('Apple iPhone 13 Pro')).toBeTruthy();
    // Park and couriers are not part of the MVP: nothing is drawn for them, and nothing about a hub PIN.
    expect(screen.queryByText(/Park/)).toBeNull();
    expect(screen.queryByText(/PIN|handover/i)).toBeNull();
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Mark as shipped' });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Waybill number'), { target: { value: 'KT-883192' } });
    expect(submit.disabled).toBe(true);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('uploads the receipt privately, ships with the platform’s ids and shows the trade as shipped', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'POST /trades/:id/ship/self-arranged': workspaceTrade('SHIPPED', 'SELLER'),
    });
    const { container } = show();
    await screen.findByLabelText('Waybill number');
    fill(container);
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mark as shipped' }).disabled).toBe(false);
    });
    expect(callsTo(api.call, 'POST', '/files/upload-url')[0]?.body).toEqual({
      category: 'OTHER',
      visibility: 'PRIVATE_CASE',
      contentType: 'image/jpeg',
    });
    // The receipt is shown as the person's own file, never as an id.
    expect(screen.getByText('receipt.jpg')).toBeTruthy();
    expect(container.textContent).not.toContain(id(55));

    fireEvent.click(screen.getByRole('button', { name: 'Mark as shipped' }));
    expect(await screen.findByRole('heading', { name: 'Marked as shipped' })).toBeTruthy();
    const body = callsTo(api.call, 'POST', '/trades/:id/ship/self-arranged')[0];
    expect(body?.params).toEqual({ id: id(1) });
    expect(body?.body).toEqual({
      waybillNumber: 'KT-883192',
      receiptFileId: id(55),
      driverPhone: '08012345678',
      vehiclePlate: 'lsr 123 ab',
    });
    expect(
      screen.getAllByRole('link', { name: 'Back to the trade' }).map((a) => a.getAttribute('href')),
    ).toEqual([`/trade/${id(1)}`, `/trade/${id(1)}`]);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says why when the platform refuses the receipt, and keeps what was typed', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'POST /trades/:id/ship/self-arranged': problem(
        'VALIDATION_FAILED',
        422,
        'Attach your own finished photo upload of the waybill receipt, not used anywhere else.',
      ),
    });
    const { container } = show();
    await screen.findByLabelText('Waybill number');
    fill(container);
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mark as shipped' }).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as shipped' }));
    expect(await screen.findByText(/Attach your own finished photo upload/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Waybill number').value).toBe('KT-883192');
  });

  it('says a failed upload did not attach, and lets the seller add the receipt again', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'POST /files/upload-url': problem('INTERNAL', 500),
    });
    const { container } = show();
    await screen.findByLabelText('Waybill number');
    fill(container);
    expect(await screen.findByText(/receipt\.jpg didn’t upload/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mark as shipped' }).disabled).toBe(true);
  });

  it('reads the platform’s own words when the ship options cannot be had', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'GET /trades/:id/ship-options': problem(
        'CONFLICT',
        409,
        'The delivery deadline has passed, so this trade can no longer be shipped.',
      ),
    });
    show();
    expect(await screen.findByText(/delivery deadline has passed/)).toBeTruthy();
    expect(screen.queryByLabelText('Waybill number')).toBeNull();
  });

  it('says plainly when the platform offers no way to ship that the app can do', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'GET /trades/:id/ship-options': { ...OPTIONS, options: [OPTIONS.options[0]] },
    });
    show();
    expect(await screen.findByText(/Shipping with your own arrangement isn’t available/)).toBeTruthy();
  });
});

describe('who and when', () => {
  it('tells the buyer that only the seller ships, without reading the options', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    show();
    expect(await screen.findByText('Only the seller ships a trade.')).toBeTruthy();
    expect(callsTo(api.call, 'GET', '/trades/:id/ship-options')).toHaveLength(0);
  });

  it('shows a trade already on its way as shipped, with no form', async () => {
    serve(workspaceTrade('SHIPPED', 'SELLER'));
    show();
    expect(await screen.findByRole('heading', { name: 'Marked as shipped' })).toBeTruthy();
    expect(screen.queryByLabelText('Waybill number')).toBeNull();
  });

  it('says a closed trade is not waiting to be shipped', async () => {
    serve(workspaceTrade('CANCELLED_REFUNDED', 'SELLER'));
    show();
    expect(await screen.findByText('This trade isn’t waiting to be shipped.')).toBeTruthy();
  });

  it('says so and offers a retry when the trade cannot be read', async () => {
    serve(problem('INTERNAL', 500));
    show();
    expect(await screen.findByText('Couldn’t open this trade')).toBeTruthy();
  });
});
