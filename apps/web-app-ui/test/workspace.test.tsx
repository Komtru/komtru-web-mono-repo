// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeScreen } from '../src/trade/TradeScreen';
import { WORKSPACE_STATUSES, type WorkspaceTab } from '../src/trade/workspace-state';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  activityRow,
  answerWith,
  callsTo,
  deliveryDeadline,
  id,
  inspectionRead,
  page,
  renderWithApi,
  tradeView,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const problem = (code: string, status: number) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const serve = (view: unknown, more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': view,
    'GET /trades/:id/delivery-deadline': deliveryDeadline(),
    'GET /trades/:id/inspection': inspectionRead(),
    'GET /trades/:id/activity': page([activityRow(1)]),
    'GET /trades': page([]),
    ...more,
  });

const show = (tab: WorkspaceTab = 'overview') =>
  renderWithApi(api.call, <TradeScreen id={id(1)} tab={tab} />);

describe('one workspace for both people', () => {
  it('draws the same trade for the buyer and the seller from yourRole, with the same chrome', async () => {
    const seen: Record<string, { heading: string; tabs: string[]; chip: boolean }> = {};
    for (const role of ['BUYER', 'SELLER'] as const) {
      serve(workspaceTrade('FUNDED', role));
      const { unmount } = show();
      await screen.findByRole('heading', { name: 'KMT-9042800-NG' });
      seen[role] = {
        heading: screen.getByRole('heading', { level: 1 }).textContent ?? '',
        tabs: within(screen.getByRole('navigation', { name: 'Trade views' }))
          .getAllByRole('link')
          .map((link) => link.textContent ?? ''),
        chip: screen.getByText('Funds protected') !== null,
      };
      unmount();
    }
    expect(seen.BUYER).toEqual(seen.SELLER);
    expect(seen.BUYER?.tabs).toEqual(['Overview', 'Terms', 'Activity', 'Actions']);
  });

  it('says the buyer is protected and the seller should prepare to dispatch, for the same status', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    const buyer = show();
    expect(await screen.findByText('Your funds are protected')).toBeTruthy();
    expect(screen.queryByText('Prepare and dispatch')).toBeNull();
    buyer.unmount();

    serve(workspaceTrade('FUNDED', 'SELLER'));
    show();
    expect(await screen.findByText('Prepare and dispatch')).toBeTruthy();
    expect(screen.queryByText('Your funds are protected')).toBeNull();
  });

  it.each(WORKSPACE_STATUSES)('draws %s with one h1, the trade code, and the same tabs', async (status) => {
    serve(workspaceTrade(status, 'BUYER'));
    const { container } = show();
    await screen.findByRole('heading', { name: 'KMT-9042800-NG' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Trade views' })).toBeTruthy();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the amount, the counterparty and the five-step progress in the summary card', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    show();
    await screen.findByText('Funds protected');
    expect(screen.getByText('₦452,000')).toBeTruthy();
    // The item and the counterparty share the summary card's one line, as the reference draws them.
    expect(screen.getByText('Apple iPhone 13 Pro · Amaka B.')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Trade progress' }).getAttribute('aria-valuetext')).toBe(
      'Shipped',
    );
  });

  it('does not draw the workspace for a proposal that is still being answered', async () => {
    serve(tradeView({ status: 'AWAITING_ACCEPTANCE', awaiting: 'YOU', yourRole: 'SELLER' }));
    show();
    expect(await screen.findByText('Accept trade request')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Trade views' })).toBeNull();
  });

  it('draws the proposal, not a workspace tab, when a tab is asked for before the agreement', async () => {
    serve(tradeView({ status: 'AWAITING_ACCEPTANCE', awaiting: 'YOU', yourRole: 'SELLER' }));
    show('activity');
    expect(await screen.findByText('Accept trade request')).toBeTruthy();
  });
});

describe('the tabs are views of the trade, not other screens', () => {
  it.each([
    ['terms', 'Agreed Terms'],
    ['activity', 'Trade Activity'],
    ['actions', 'Trade Actions'],
  ] as const)(
    'titles the %s tab "%s", with a way back to the trade and no second summary card',
    async (tab, title) => {
      serve(workspaceTrade('FUNDED', 'BUYER'));
      show(tab);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Back to the trade' }).getAttribute('href')).toBe(
        `/trade/${id(1)}`,
      );
      expect(screen.queryByRole('progressbar')).toBeNull();
      // Still the same navigation, so each view is one tap from the others.
      expect(screen.getByRole('navigation', { name: 'Trade views' })).toBeTruthy();
    },
  );

  it('heads the overview with the trade code and goes back to the list', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    show();
    await screen.findByRole('heading', { level: 1, name: 'KMT-9042800-NG' });
    for (const link of screen.getAllByRole('link', { name: 'Back to your trades' })) {
      expect(link.getAttribute('href')).toBe('/trades');
    }
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });
});

describe('agreed, awaiting funding (CWT-01)', () => {
  it('keeps the agreement screen and offers no payment control, because funding is a later feature', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'));
    show();
    expect(await screen.findByRole('heading', { name: 'Terms agreed' })).toBeTruthy();
    expect(screen.getByText('Awaiting funding')).toBeTruthy();
    expect(screen.getByText(/Payment isn't available in the app yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay|fund/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /pay|fund/i })).toBeNull();
  });
});

describe('funds protected (CWT-02)', () => {
  it('shows the seller the delivery deadline in Lagos time and what they are paid, held', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    show();
    expect(await screen.findByText('Ship by · 12 Nov · 10:00')).toBeTruthy();
    const money = screen.getByLabelText('Money');
    expect(within(money).getByText('Protected funds').nextElementSibling?.textContent).toBe(
      'Confirmed · ₦452,000',
    );
    expect(within(money).getByText('Your payout').nextElementSibling?.textContent).toContain(
      'held, not yet released',
    );
    expect(screen.getByText("Marking the item shipped isn't in the app yet.")).toBeTruthy();
  });

  it('shows the buyer what they paid and when the seller must ship', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    show();
    expect(await screen.findByText('The seller ships by · 12 Nov · 10:00')).toBeTruthy();
    expect(within(screen.getByLabelText('Money')).getByText('You paid').nextElementSibling?.textContent).toBe(
      '₦458,780',
    );
    expect(screen.queryByText("Marking the item shipped isn't in the app yet.")).toBeNull();
  });

  it.each(['BUYER', 'SELLER'] as const)('offers no ship, fund or pay control to the %s', async (role) => {
    serve(workspaceTrade('FUNDED', role));
    show();
    await screen.findByText('Funds protected');
    expect(screen.queryByRole('button', { name: /ship|dispatch|fund|pay/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /ship|dispatch|fund|pay/i })).toBeNull();
  });

  it('says the deadline could not be loaded and lets the person try again, without losing the rest', async () => {
    let attempt = 0;
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'GET /trades/:id/delivery-deadline': () => {
        attempt += 1;
        if (attempt === 1) throw problem('INTERNAL', 500);
        return deliveryDeadline();
      },
    });
    show();
    expect(await screen.findByText(/couldn't load the delivery deadline\./i)).toBeTruthy();
    expect(screen.getByText('Prepare and dispatch')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ship by · 12 Nov · 10:00')).toBeTruthy();
  });

  it('names the thing it could not load, whichever deadline it was', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'GET /trades/:id/inspection': () => {
        throw problem('INTERNAL', 500);
      },
    });
    show();
    expect(await screen.findByText(/couldn't load the inspection deadline\./i)).toBeTruthy();
  });

  it('does not read the inspection or the activity for a trade that has only just been paid for', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    show();
    await screen.findByText('Funds protected');
    expect(callsTo(api.call, 'GET', '/trades/:id/inspection')).toHaveLength(0);
    expect(callsTo(api.call, 'GET', '/trades/:id/activity')).toHaveLength(0);
  });
});

describe('in transit and delivery (CWT-03)', () => {
  it('shows the shipment the platform recorded: when it was handed over, and the waybill', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'));
    show();
    expect(await screen.findByText('Your item is in transit')).toBeTruthy();
    const shipment = await screen.findByLabelText('Shipment');
    expect(within(shipment).getByText('KT-883192')).toBeTruthy();
    expect(within(shipment).getByText(/30 Sep · 13:18/)).toBeTruthy();
  });

  it('draws no courier tracking card, because the platform records none', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'));
    show();
    await screen.findByLabelText('Shipment');
    expect(screen.queryByText(/last update|out for delivery|courier partner/i)).toBeNull();
  });

  it('words it for the seller as the item being on its way, with no waybill if none was recorded', async () => {
    serve(workspaceTrade('SHIPPED', 'SELLER'), {
      'GET /trades/:id/inspection': inspectionRead({ deliveryEvidence: { selfArranged: null } }),
    });
    show();
    expect(await screen.findByText('The item is on its way')).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Shipment')).toBeNull());
  });

  it('asks the buyer whether it arrived, and says what happens if they do not answer', async () => {
    serve(workspaceTrade('UNCONFIRMED_DELIVERY', 'BUYER'));
    show();
    expect(await screen.findByText('Did it arrive?')).toBeTruthy();
    expect(screen.getByText(/within 24 hours/)).toBeTruthy();
    expect(screen.getByText("Confirming delivery isn't in the app yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
  });

  it('tells the seller the buyer has to confirm, with nothing to press', async () => {
    serve(workspaceTrade('UNCONFIRMED_DELIVERY', 'SELLER'));
    show();
    expect(await screen.findByText('Waiting for the buyer to confirm')).toBeTruthy();
    expect(screen.queryByText("Confirming delivery isn't in the app yet.")).toBeNull();
  });
});

describe('inspection (CWT-04)', () => {
  it("shows when it started and ends, the category and the window, from the platform's read", async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    show();
    expect(await screen.findByText('Inspection ends · 2 Oct · 13:24')).toBeTruthy();
    const rows = screen.getByLabelText('Inspection window');
    expect(within(rows).getByText('Category').nextElementSibling?.textContent).toBe('Electronics');
    expect(within(rows).getByText('Window').nextElementSibling?.textContent).toBe('48 hours');
    expect(within(rows).getByText('Started').nextElementSibling?.textContent).toBe('30 Sep · 13:24');
    expect(within(rows).getByText('Ends').nextElementSibling?.textContent).toBe('2 Oct · 13:24');
  });

  it('says the buyer can inspect, and the seller that the payment is released if nothing is reported', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    const buyer = show();
    expect(await screen.findByText('Inspect the item')).toBeTruthy();
    buyer.unmount();
    serve(workspaceTrade('INSPECTION', 'SELLER'), {
      'GET /trades/:id/inspection': inspectionRead({ yourRole: 'SELLER' }),
    });
    show();
    expect(await screen.findByText('The buyer is inspecting the item')).toBeTruthy();
    expect(screen.getByText(/released to you automatically/)).toBeTruthy();
  });

  it.each([
    ['BUYER', /You asked the seller for more time/],
    ['SELLER', /The buyer asked for more inspection time/],
  ] as const)(
    'tells the %s about a pending request for more time in their own words',
    async (role, words) => {
      serve(workspaceTrade('INSPECTION', role), {
        'GET /trades/:id/inspection': inspectionRead({ extensionRequest: { id: id(95), status: 'PENDING' } }),
      });
      show();
      expect(await screen.findByText(words)).toBeTruthy();
    },
  );

  it('warns that automatic release is paused while Komtru has a hold on it', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'GET /trades/:id/inspection': inspectionRead({
        window: { ...inspectionRead().window, autoReleasePaused: true },
      }),
    });
    show();
    expect(await screen.findByText('Automatic release is paused')).toBeTruthy();
  });

  it('offers no accept, report or extension control: those are the inspection feature', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    show();
    await screen.findByText('Inspect the item');
    expect(screen.queryByRole('button', { name: /accept|release|report|time|inspect/i })).toBeNull();
    expect(screen.getByText(/aren't in the app yet/)).toBeTruthy();
  });
});

describe('disputed, settlement and completion (CWT-05, CWT-06, Customer-5)', () => {
  it('says the funds stay protected while a case is open, without inventing a case', async () => {
    serve(workspaceTrade('DISPUTED', 'BUYER'));
    show();
    expect(await screen.findByText('Issue reported — funds remain protected')).toBeTruthy();
    expect(screen.getByText('Seller payout').nextElementSibling?.textContent).toContain(
      'held while the case is open',
    );
    expect(screen.queryByText(/DIS-\d+/)).toBeNull();
    expect(screen.queryByRole('button', { name: /evidence/i })).toBeNull();
  });

  it('says settlement is processing and not yet a payout', async () => {
    serve(workspaceTrade('COMPLETED', 'SELLER'));
    show();
    expect(await screen.findByText('Settlement is processing')).toBeTruthy();
    expect(screen.getByText(/not yet a completed payout/)).toBeTruthy();
    expect(screen.getByText('Status').nextElementSibling?.textContent).toBe('Processing · ₦452,000');
  });

  it('celebrates a settled trade to the buyer with who was paid, and to the seller with what they got', async () => {
    serve(workspaceTrade('SETTLED', 'BUYER'));
    const buyer = show();
    expect(await screen.findByRole('heading', { name: 'Trade complete' })).toBeTruthy();
    expect(screen.getByText(/₦452,000 released to Amaka B\./)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /review/i })).toBeNull();
    buyer.unmount();

    serve(
      workspaceTrade('SETTLED', 'SELLER', {
        fees: { ...workspaceTrade('SETTLED').fees, sellerProceedsMinor: '44000000' },
      }),
    );
    show();
    expect(await screen.findByText(/₦440,000 released to you\./)).toBeTruthy();
  });

  it.each([
    ['RESOLVED_RELEASED', 'BUYER', 'Decided: released to the seller'],
    ['RESOLVED_REFUNDED', 'SELLER', 'Decided: refunded to the buyer'],
    ['CANCELLED_REFUNDED', 'BUYER', 'Cancelled and refunded'],
  ] as const)(
    'records the outcome %s without claiming the money has arrived',
    async (status, role, title) => {
      serve(workspaceTrade(status, role));
      show();
      expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
      expect(screen.getByText(/not a confirmation that the money has arrived/)).toBeTruthy();
    },
  );
});

describe('the terms tab (CWT-07)', () => {
  it('shows the recorded terms, when they were accepted, and what it comes to for the reader', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    show('terms');
    expect(await screen.findByText('Terms recorded')).toBeTruthy();
    const terms = screen.getByLabelText('Terms of this trade');
    expect(within(terms).getByText('Accepted').nextElementSibling?.textContent).toBe('30 Sep · 09:41');
    expect(within(terms).getByText('Version').nextElementSibling?.textContent).toBe('2');
    expect(within(screen.getByLabelText('What this comes to')).getByText('You receive')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Versions of this agreement' })).toBeTruthy();
  });

  it('shows the buyer the protection fee and the total', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    show('terms');
    const fees = await screen.findByLabelText('What this comes to');
    expect(within(fees).getByText('You pay').nextElementSibling?.textContent).toBe('₦458,780.00');
  });

  it('marks the Terms tab current', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    show('terms');
    await screen.findByText('Terms recorded');
    const tabs = within(screen.getByRole('navigation', { name: 'Trade views' }));
    expect(tabs.getByRole('link', { name: 'Terms' }).getAttribute('aria-current')).toBe('page');
    expect(tabs.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('the activity tab (CWT-08)', () => {
  it('lists what happened newest first, who did it from the reader’s side, and when', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'GET /trades/:id/activity': page([
        activityRow(3, { kind: 'SHIPPED', actor: 'OTHER_PARTY', occurredAt: '2026-09-30T12:18:00.000000Z' }),
        activityRow(2, {
          kind: 'FUNDS_PROTECTED',
          actor: 'KOMTRU',
          occurredAt: '2026-09-30T13:42:00.000000Z',
        }),
        activityRow(1, { kind: 'TERMS_AGREED', actor: 'YOU', occurredAt: '2026-09-30T08:40:00.000000Z' }),
      ]),
    });
    show('activity');
    const list = await screen.findByRole('list', { name: 'Trade activity' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual([
      'Seller dispatched',
      'Payment confirmed',
      'Terms agreed',
    ]);
    expect(rows[0]?.textContent).toContain('30 Sep · 13:18 · The seller');
    expect(rows[1]?.textContent).toContain('Komtru');
    expect(rows[2]?.textContent).toContain('You');
  });

  it('shows a reason the other party gave, and the same row to the seller in the seller’s words', async () => {
    const declined = page([
      activityRow(1, {
        kind: 'PROPOSAL_DECLINED',
        actor: 'OTHER_PARTY',
        toStatus: 'DECLINED',
        reason: 'Too expensive',
      }),
    ]);
    serve(workspaceTrade('FUNDED', 'SELLER'), { 'GET /trades/:id/activity': declined });
    show('activity');
    const list = await screen.findByRole('list', { name: 'Trade activity' });
    expect(list.textContent).toContain('The buyer');
    expect(list.textContent).toContain('Reason: Too expensive');
  });

  it('pages with the cursor exactly as the platform sent it', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'), {
      'GET /trades/:id/activity': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined
          ? { items: [activityRow(2)], nextCursor: 'a b+c/d==' }
          : { items: [activityRow(1, { kind: 'TERMS_AGREED', actor: 'YOU' })], nextCursor: null },
    });
    show('activity');
    fireEvent.click(await screen.findByRole('button', { name: 'Show earlier activity' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Trade activity' })).getAllByRole('listitem'),
      ).toHaveLength(2),
    );
    expect(callsTo(api.call, 'GET', '/trades/:id/activity').map((c) => c.query?.cursor)).toEqual([
      undefined,
      'a b+c/d==',
    ]);
    expect(screen.queryByRole('button', { name: 'Show earlier activity' })).toBeNull();
  });

  it('says it could not load the activity and tries again', async () => {
    let attempt = 0;
    serve(workspaceTrade('FUNDED', 'BUYER'), {
      'GET /trades/:id/activity': () => {
        attempt += 1;
        if (attempt === 1) throw problem('INTERNAL', 500);
        return page([activityRow(1)]);
      },
    });
    show('activity');
    expect(await screen.findByText("Couldn't load the activity")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Trade activity' })).toBeTruthy();
  });

  it('explains that Komtru’s own steps appear simply as Komtru', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    show('activity');
    expect(await screen.findByText(/appear simply as Komtru/)).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
  });
});

describe('the actions tab (CWT-09)', () => {
  it('lists what the buyer can and cannot do yet, and gives a control only to what works', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    const { container } = show('actions');
    const list = await screen.findByRole('list', { name: 'Actions on this trade' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual([
      'View agreed terms · Safe',
      'Accept the item · Buyer',
      'Ask for more time · Buyer',
      'Report an issue · Buyer',
      'Release funds · Guarded',
    ]);
    expect(within(rows[1]!).getByText(/Not in the app yet/)).toBeTruthy();
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /accept|report|release|withdraw/i })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('lists the seller’s own rows, not the buyer’s', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    show('actions');
    const list = await screen.findByRole('list', { name: 'Actions on this trade' });
    const titles = within(list)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('b')?.textContent);
    expect(titles).toContain('Ship the item · Seller');
    expect(titles).not.toContain('Fund trade · Buyer');
  });

  describe('withdrawing before payment', () => {
    it('asks once, cancels the trade, and then shows it as ended', async () => {
      serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), {
        'POST /trades/:id/cancel': workspaceTrade('CANCELLED', 'BUYER'),
      });
      show('actions');
      fireEvent.click(await screen.findByRole('button', { name: 'Withdraw from this trade' }));
      const sheet = await screen.findByRole('dialog');
      expect(callsTo(api.call, 'POST', '/trades/:id/cancel')).toHaveLength(0);
      fireEvent.click(within(sheet).getByRole('button', { name: 'Withdraw' }));
      expect(await screen.findByRole('heading', { name: 'Request cancelled' })).toBeTruthy();
      expect(callsTo(api.call, 'POST', '/trades/:id/cancel')[0]).toMatchObject({
        params: { id: id(1) },
        body: {},
      });
    });

    it('lets either party do it', async () => {
      serve(workspaceTrade('PENDING_PAYMENT', 'SELLER'));
      show('actions');
      expect(await screen.findByRole('button', { name: 'Withdraw from this trade' })).toBeTruthy();
    });

    it('says why when the platform refuses, and keeps the trade as it was', async () => {
      serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), {
        'POST /trades/:id/cancel': problem('INVALID_TRANSITION', 409),
      });
      show('actions');
      fireEvent.click(await screen.findByRole('button', { name: 'Withdraw from this trade' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw' }));
      expect(await screen.findByText(/This trade has moved on since you opened it/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Withdraw from this trade' })).toBeTruthy();
    });

    it.each(['FUNDED', 'SHIPPED', 'INSPECTION', 'DISPUTED', 'COMPLETED'])(
      'offers no withdrawal once the trade is %s',
      async (status) => {
        serve(workspaceTrade(status, 'BUYER'));
        show('actions');
        await screen.findByRole('list', { name: 'Actions on this trade' });
        expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
      },
    );
  });
});
