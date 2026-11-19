// @vitest-environment jsdom
// F-069 / F-073 (DX-19, TX-12): the dispatch workspace. The ship form is the phone's (`ship-order.test.tsx`); what is
// tested here is that a tablet and a desktop get the checklist, the order and the route beside the proof fields, that
// the form still works there, and that the phone is left as it was.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DispatchRoute } from '../src/trade/shipping/DispatchRoute';
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
import { setWidth, type Width } from './support/viewport';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  api.call.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  );
});

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

const serve = (trade: unknown, more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/ship-options': OPTIONS,
    'GET /trades/:id/delivery-deadline': deliveryDeadline(),
    'POST /files/upload-url': {
      fileId: id(55),
      cloudName: 'komtru',
      uploadUrl: 'https://upload.test/x',
      params: { signature: 's' },
      maxBytes: 5_000_000,
      expiresAt: '2026-11-11T12:00:00.000Z',
    },
    'POST /files/:id/finalize': { fileId: id(55), uploadState: 'PENDING' },
    ...more,
  });

describe.each([['tablet'], ['desktop']] as [Width][])('The dispatch workspace at a %s', (width) => {
  beforeEach(() => setWidth(width));

  it('names the trade and says payment is protected, with the checklist, the order and the route beside the proof', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    const { container } = renderWithApi(api.call, <ShipOrder id={id(1)} />);
    expect(await screen.findByLabelText('Waybill number')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Dispatch KMT-9042800-NG' })).toBeTruthy();
    expect(screen.getByText('Payment is protected. Confirm the route and hand the item over.')).toBeTruthy();

    const checklist = screen.getByRole('group', { name: 'Handover checklist' });
    expect(within(checklist).getAllByRole('checkbox')).toHaveLength(2);
    const order = screen.getByRole('complementary', { name: 'Order and route' });
    expect(within(order).getByText('Apple iPhone 13 Pro')).toBeTruthy();
    expect(within(order).getByRole('heading', { name: 'How it travels' })).toBeTruthy();
    expect(within(order).getByText(/You arrange the delivery yourself/)).toBeTruthy();
    // Park and couriers are out of the MVP: no option is drawn for them.
    expect(screen.queryByText(/Park/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to orders' }).getAttribute('href')).toBe('/orders');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('keeps the checklist a reminder: ticking it opens nothing, and the evidence still does', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'POST /trades/:id/ship/self-arranged': workspaceTrade('SHIPPED', 'SELLER'),
    });
    const { container } = renderWithApi(api.call, <ShipOrder id={id(1)} />);
    await screen.findByLabelText('Waybill number');
    for (const box of within(screen.getByRole('group', { name: 'Handover checklist' })).getAllByRole(
      'checkbox',
    )) {
      fireEvent.click(box);
    }
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Mark as dispatched' });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Waybill number'), { target: { value: 'KT-883192' } });
    fireEvent.change(screen.getByLabelText('Driver or rider phone'), { target: { value: '08012345678' } });
    fireEvent.change(screen.getByLabelText('Vehicle registration plate'), {
      target: { value: 'lsr 123 ab' },
    });
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'receipt.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    expect(await screen.findByRole('heading', { name: 'Marked as shipped' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/ship/self-arranged')[0]?.body).toEqual({
      waybillNumber: 'KT-883192',
      receiptFileId: id(55),
      driverPhone: '08012345678',
      vehiclePlate: 'LSR 123 AB',
    });
  });

  it('still says dispatch is locked until the payment is protected', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'SELLER'));
    renderWithApi(api.call, <ShipOrder id={id(1)} />);
    expect(await screen.findByText(/Dispatch Locked/)).toBeTruthy();
    expect(screen.queryByLabelText('Waybill number')).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Dispatch locked' }).disabled).toBe(true);
  });
});

describe('The dispatch workspace on a phone', () => {
  it('is the phone’s ship form, with no checklist of its own', async () => {
    setWidth('phone');
    serve(workspaceTrade('FUNDED', 'SELLER'));
    renderWithApi(api.call, <ShipOrder id={id(1)} />);
    expect(await screen.findByLabelText('Waybill number')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Ship KMT-9042800-NG' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Handover checklist' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark as shipped' })).toBeTruthy();
  });
});

describe('The dispatch route', () => {
  it('opens the workspace from a tablet up, so Orders’ Dispatch lands on it', async () => {
    setWidth('tablet');
    serve(workspaceTrade('FUNDED', 'SELLER'));
    renderWithApi(api.call, <DispatchRoute id={id(1)} />);
    expect(await screen.findByLabelText('Waybill number')).toBeTruthy();
  });

  it('keeps the phone’s own dispatch step', async () => {
    setWidth('phone');
    serve(workspaceTrade('FUNDED', 'SELLER'));
    renderWithApi(api.call, <DispatchRoute id={id(1)} />);
    expect(await screen.findByText('Handover checklist')).toBeTruthy();
    expect(screen.queryByLabelText('Waybill number')).toBeNull();
  });
});
