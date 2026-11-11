// @vitest-environment jsdom
// F-027: Inspect & Confirm (Customer-4, Z4), the release sheet (Z5), asking for more time (BEI1) and the seller's
// answer (BEI2). The platform decides what is allowed; these screens show what it says and send what it asked for.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inspect } from '../src/trade/inspection/Inspect';
import { extraHourChoices } from '../src/trade/inspection/sheets';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  fileRead,
  id,
  inspectionRead,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const problem = (code: string, status: number, detail?: string) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded', status, code, ...(detail ? { detail } : {}) },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const serve = (trade: unknown, read: unknown = inspectionRead(), more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/inspection': read,
    'GET /files/:id': (input: { params?: Record<string, string> }) =>
      fileRead(input.params?.id === id(8) ? 8 : 7),
    ...more,
  });

const show = () => renderWithApi(api.call, <Inspect id={id(1)} />);

describe('Z4: compare the seller’s proof with what arrived', () => {
  it('shows the seller’s photos beside the delivery evidence, and how long the buyer has', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    const { container } = show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Inspect & Confirm' })).toBeTruthy();
    const proof = await screen.findByRole('region', { name: "Seller's proof" });
    await waitFor(() => {
      expect(within(proof).getAllByRole('img')).toHaveLength(2);
    });
    expect(within(proof).getAllByRole('img')[0]?.getAttribute('src')).toBe('https://files.test/7.jpg?sig=1');
    const evidence = screen.getByLabelText('Delivery evidence');
    expect(within(evidence).getByText('KT-883192')).toBeTruthy();
    expect(within(evidence).getByText('LSR123AB')).toBeTruthy();
    expect(within(evidence).getByText(/Reported delivered by the seller/)).toBeTruthy();
    expect(screen.getByText('Inspection ends · 2 Oct · 13:24')).toBeTruthy();
    expect(
      screen.getByText(/If you don’t respond by then, the payment is released to the seller/),
    ).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says so when the seller attached no photos, and when a photo cannot be loaded', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), inspectionRead({ sellerProof: { media: [] } }));
    const first = show();
    expect(await screen.findByText(/No proof photos were attached/)).toBeTruthy();
    first.unmount();
    serve(workspaceTrade('INSPECTION', 'BUYER'), undefined, {
      'GET /files/:id': problem('NOT_FOUND', 404),
    });
    show();
    await waitFor(() => {
      expect(screen.getAllByText(/didn’t load/)).toHaveLength(2);
    });
  });

  it('says the clock is stopped when a hold has paused the automatic release', async () => {
    serve(
      workspaceTrade('INSPECTION', 'BUYER'),
      inspectionRead({ window: { ...inspectionRead().window, autoReleasePaused: true } }),
    );
    show();
    expect(await screen.findByText('Automatic release is paused')).toBeTruthy();
  });

  it('tells a buyer whose trade has not reached inspection where to confirm that it arrived', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'));
    show();
    expect(await screen.findByText(/Inspection starts when you confirm the item has arrived/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /confirm & release/i })).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades/:id/inspection').length).toBeLessThanOrEqual(1);
  });

  it('shows the finished trade once the payment has been released', async () => {
    serve(workspaceTrade('COMPLETED', 'BUYER'));
    show();
    expect(await screen.findByText('You released the payment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /confirm & release/i })).toBeNull();
  });
});

describe('Z5: confirm and release, behind an explicit acknowledgement', () => {
  const open = async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & Release Payment' }));
    return screen.findByRole('dialog');
  };

  it('names the amount and who gets it, says it cannot be undone, and sends nothing until the box is ticked', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    const dialog = await open();
    expect(within(dialog).getByText(/Release ₦452,000 to Amaka B\.\?/)).toBeTruthy();
    expect(within(dialog).getByText(/can’t be undone/)).toBeTruthy();
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Confirm & Release' });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(callsTo(api.call, 'POST', '/trades/:id/accept-inspection')).toHaveLength(0);
    await expectNoAxeViolations(dialog, SHELL_RULES);
  });

  it('releases with the acknowledgement once ticked, and the screen becomes the finished trade', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), undefined, {
      'POST /trades/:id/accept-inspection': workspaceTrade('COMPLETED', 'BUYER'),
    });
    const dialog = await open();
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: /compared the item to the seller’s proof/ }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm & Release' }));
    expect(await screen.findByText('You released the payment')).toBeTruthy();
    const calls = callsTo(api.call, 'POST', '/trades/:id/accept-inspection');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ params: { id: id(1) }, body: { acknowledged: true } });
  });

  it('shows the platform’s own words when it refuses (a hold), keeps the sheet open and the box ticked', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), undefined, {
      'POST /trades/:id/accept-inspection': problem(
        'HOLD_ACTIVE',
        409,
        'The payment can’t be released while the trade is on hold.',
      ),
    });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm & Release' }));
    expect(await within(dialog).findByText(/can’t be released while the trade is on hold/)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
    expect(screen.queryByText('You released the payment')).toBeNull();
  });

  it('closes without sending anything on Cancel', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(callsTo(api.call, 'POST', '/trades/:id/accept-inspection')).toHaveLength(0);
  });
});

describe('one press, one call', () => {
  it('sends the release once however many times Confirm & Release is pressed', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), undefined, {
      'POST /trades/:id/accept-inspection': workspaceTrade('COMPLETED', 'BUYER'),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & Release Payment' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    const confirm = within(dialog).getByRole('button', { name: 'Confirm & Release' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByText('You released the payment');
    expect(callsTo(api.call, 'POST', '/trades/:id/accept-inspection')).toHaveLength(1);
  });
});

describe('an agreed extension', () => {
  it('tells the buyer the seller agreed', async () => {
    serve(
      workspaceTrade('INSPECTION', 'BUYER'),
      inspectionRead({
        canRequestMoreTime: false,
        extensionRequest: { id: id(95), status: 'ACCEPTED', extraHours: 24 },
      }),
    );
    show();
    expect(await screen.findByText('More time was agreed')).toBeTruthy();
  });
});

describe('BEI1: the buyer asks the seller for more time, once', () => {
  it('offers only choices within one original window, and sends the hours and a note', async () => {
    expect(extraHourChoices(48)).toEqual([12, 24, 48]);
    expect(extraHourChoices(24)).toEqual([12, 24]);
    expect(extraHourChoices(6)).toEqual([6]);
    serve(workspaceTrade('INSPECTION', 'BUYER'), undefined, {
      'POST /trades/:id/inspection-extension': { id: id(95), status: 'PENDING', extraHours: 24 },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for more time' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Send request' });
    expect(send.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: '24 hours more' }));
    fireEvent.change(within(dialog).getByLabelText(/Why do you need more time/), {
      target: { value: 'Travelling' },
    });
    fireEvent.click(send);
    await waitFor(() => {
      expect(callsTo(api.call, 'POST', '/trades/:id/inspection-extension')).toHaveLength(1);
    });
    expect(callsTo(api.call, 'POST', '/trades/:id/inspection-extension')[0]).toMatchObject({
      params: { id: id(1) },
      body: { extraHours: 24, note: 'Travelling' },
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('does not offer the ask once the platform says it cannot be made, and says a request is waiting', async () => {
    serve(
      workspaceTrade('INSPECTION', 'BUYER'),
      inspectionRead({
        canRequestMoreTime: false,
        extensionRequest: { id: id(95), status: 'PENDING', extraHours: 24 },
      }),
    );
    show();
    expect(await screen.findByText('More inspection time was asked for')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask for more time' })).toBeNull();
  });

  it('shows the platform’s refusal in its own words', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), undefined, {
      'POST /trades/:id/inspection-extension': problem(
        'VALIDATION_FAILED',
        422,
        'You can ask for at most 48 more hours.',
      ),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for more time' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: '12 hours more' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(await within(dialog).findByText('You can ask for at most 48 more hours.')).toBeTruthy();
  });
});

describe('BEI2: the seller answers', () => {
  const asked = inspectionRead({
    yourRole: 'SELLER',
    canRespondToRequest: true,
    canRequestMoreTime: false,
    extensionRequest: { id: id(95), status: 'PENDING', extraHours: 24, note: 'Travelling' },
  });

  it('shows the request beside the standard it changes, with no buyer controls and no release', async () => {
    serve(workspaceTrade('INSPECTION', 'SELLER'), asked);
    const { container } = show();
    expect(await screen.findByText('The buyer wants more time')).toBeTruthy();
    const rows = screen.getByLabelText('Request for more inspection time');
    expect(within(rows).getByText('48 hours standard')).toBeTruthy();
    expect(within(rows).getByText('24 hours more')).toBeTruthy();
    expect(within(rows).getByText('Travelling')).toBeTruthy();
    expect(screen.getByText(/funds stay just as protected either way/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /release|ask for more time/i })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it.each([
    ['Accept 24 hours more', 'accept'],
    ['Decline', 'decline'],
  ] as const)('%s calls the platform’s %s route for that request', async (name, route) => {
    serve(workspaceTrade('INSPECTION', 'SELLER'), asked, {
      [`POST /trades/:id/inspection-extension/:requestId/${route}`]: { id: id(95), status: 'ACCEPTED' },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name }));
    await waitFor(() => {
      expect(callsTo(api.call, 'POST', `/trades/:id/inspection-extension/:requestId/${route}`)).toHaveLength(
        1,
      );
    });
    expect(
      callsTo(api.call, 'POST', `/trades/:id/inspection-extension/:requestId/${route}`)[0],
    ).toMatchObject({ params: { id: id(1), requestId: id(95) } });
  });

  it('says plainly that there is nothing to answer when the buyer has not asked', async () => {
    serve(
      workspaceTrade('INSPECTION', 'SELLER'),
      inspectionRead({ yourRole: 'SELLER', canRequestMoreTime: false }),
    );
    show();
    expect(await screen.findByText('The buyer hasn’t asked for more time.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /accept|decline/i })).toBeNull();
  });
});
