import { TRADE_ACTIVITY_KINDS, type TradeActivityItem } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import { describeTrade, whenLabel } from '../src/trade/format';
import {
  WORKSPACE_STATUSES,
  WORKSPACE_TABS,
  WORKSPACE_TAB_DEFS,
  isWorkspaceTab,
  tabTitle,
  actorLabel,
  describeActivity,
  isWorkspaceStatus,
  tabHref,
  tabItems,
  tradeActions,
  dispatchHref,
  waybillHref,
  trackHref,
  pickupHref,
  evidenceHref,
  addEvidenceHref,
  shipHref,
  workspaceStanding,
  type TradeRole,
} from '../src/trade/workspace-state';

const ID = '0190b0a0-0000-7000-8000-000000000001';
const ROLES: TradeRole[] = ['BUYER', 'SELLER'];

describe('which statuses are the workspace', () => {
  it('is every status from the agreement onward and nothing before it', () => {
    for (const status of WORKSPACE_STATUSES) expect(isWorkspaceStatus(status)).toBe(true);
    for (const status of [
      'DRAFT',
      'PENDING_COUNTERPARTY',
      'UNDER_PROPOSAL_REVIEW',
      'AWAITING_ACCEPTANCE',
      'DECLINED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED',
      'SOMETHING_NEW',
    ]) {
      expect(isWorkspaceStatus(status), status).toBe(false);
    }
  });
});

describe('where a trade stands', () => {
  it.each(WORKSPACE_STATUSES)('has a chip and a place on the five-step bar for %s', (status) => {
    const standing = workspaceStanding(status);
    expect(standing.chip.label.length).toBeGreaterThan(0);
    if (standing.stage !== undefined) {
      expect(standing.stage).toBeGreaterThanOrEqual(1);
      expect(standing.stage).toBeLessThanOrEqual(5);
    }
  });

  it("names each state as the reference's chip does", () => {
    expect(workspaceStanding('PENDING_PAYMENT').chip.label).toBe('Awaiting funding');
    expect(workspaceStanding('FUNDED').chip.label).toBe('Funds protected');
    expect(workspaceStanding('SHIPPED').chip.label).toBe('In transit');
    expect(workspaceStanding('INSPECTION').chip.label).toBe('Inspection active');
    expect(workspaceStanding('DISPUTED').chip.label).toBe('Disputed');
    expect(workspaceStanding('COMPLETED').chip.label).toBe('Settlement pending');
  });

  it('only moves forward along the bar while a trade is going well', () => {
    const route = ['PENDING_PAYMENT', 'FUNDED', 'SHIPPED', 'INSPECTION', 'COMPLETED'] as const;
    const stages = route.map((status) => workspaceStanding(status).stage ?? 0);
    expect([...stages].sort((a, b) => a - b)).toEqual(stages);
  });

  it('draws no progress for a refund, and marks every finished trade closed', () => {
    expect(workspaceStanding('CANCELLED_REFUNDED').stage).toBeUndefined();
    for (const status of [
      'SETTLED',
      'RESOLVED_RELEASED',
      'RESOLVED_REFUNDED',
      'CANCELLED_REFUNDED',
    ] as const) {
      expect(workspaceStanding(status).closed, status).toBe(true);
    }
    for (const status of ['FUNDED', 'INSPECTION', 'DISPUTED', 'COMPLETED'] as const) {
      expect(workspaceStanding(status).closed, status).toBe(false);
    }
  });

  it('is what the trades list calls the same trade, so the two never disagree', () => {
    for (const status of WORKSPACE_STATUSES) {
      if (status === 'PENDING_PAYMENT') continue; // the list says "Terms agreed" until it is paid for
      const row = describeTrade({ status, attention: null, tradeCode: 'KMT-9042800-NG' });
      expect(row.label).toBe(workspaceStanding(status).chip.label);
      expect(row.closed).toBe(workspaceStanding(status).closed);
    }
  });
});

describe('the tabs', () => {
  it('addresses the overview as the trade itself and every other tab beneath it', () => {
    expect(tabHref(ID, 'overview')).toBe(`/trade/${ID}`);
    expect(tabHref(ID, 'terms')).toBe(`/trade/${ID}/terms`);
    expect(tabHref(ID, 'activity')).toBe(`/trade/${ID}/activity`);
    expect(tabHref(ID, 'actions')).toBe(`/trade/${ID}/actions`);
    expect(tabItems(ID).map((tab) => tab.id)).toEqual([...WORKSPACE_TABS]);
  });
});

describe('the delivery and evidence sheets (F-028)', () => {
  it('addresses each sheet beneath the trade, and sends the seller to dispatch readiness first', () => {
    expect(dispatchHref(ID)).toBe(`/trade/${ID}/dispatch`);
    expect(waybillHref(ID)).toBe(`/trade/${ID}/dispatch/waybill`);
    expect(trackHref(ID)).toBe(`/trade/${ID}/track`);
    expect(pickupHref(ID)).toBe(`/trade/${ID}/pickup`);
    expect(evidenceHref(ID)).toBe(`/trade/${ID}/evidence`);
    expect(addEvidenceHref(ID)).toBe(`/trade/${ID}/evidence/new`);
    expect(shipHref(ID)).toBe(dispatchHref(ID));
    // A shipped trade's "Report delivery" lives on the dispatch sheet, so the row points there and is live.
    expect(tradeActions('SHIPPED', 'SELLER', ID).find((row) => row.id === 'report-delivered')).toMatchObject({
      availability: 'live',
      href: dispatchHref(ID),
    });
  });
});

describe('what can be done', () => {
  const live = (status: (typeof WORKSPACE_STATUSES)[number], role: TradeRole) =>
    tradeActions(status, role, ID)
      .filter((row) => row.availability === 'live')
      .map((row) => row.id);

  it.each(WORKSPACE_STATUSES.flatMap((status) => ROLES.map((role) => [status, role] as const)))(
    'offers only what is real for %s as the %s: what the app really does at each state',
    (status, role) => {
      const key = `${status} ${role}`;
      const expected: Record<string, string[]> = {
        'FUNDED SELLER': ['view-terms', 'ship', 'ask-more-time'],
        'SHIPPED SELLER': ['view-terms', 'ask-more-time', 'report-delivered'],
        'SHIPPED BUYER': ['view-terms', 'confirm-delivery'],
        'UNCONFIRMED_DELIVERY BUYER': ['view-terms', 'confirm-delivery'],
        'INSPECTION BUYER': ['view-terms', 'accept', 'more-time'],
        'INSPECTION SELLER': ['view-terms', 'answer-extension'],
        'PENDING_PAYMENT BUYER': ['view-terms', 'fund', 'cancel'],
        'PENDING_PAYMENT SELLER': ['view-terms', 'cancel'],
      };
      // F-028: the delivery and evidence sheets are on offer, for either side, once the item has shipped.
      const tracked = ['SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION'].includes(status) ? ['track'] : [];
      const evidenced = [
        'SHIPPED',
        'UNCONFIRMED_DELIVERY',
        'INSPECTION',
        'DISPUTED',
        'COMPLETED',
        'SETTLED',
        'RESOLVED_RELEASED',
        'RESOLVED_REFUNDED',
      ].includes(status)
        ? ['evidence']
        : [];
      expect(live(status, role).sort()).toEqual(
        [...(expected[key] ?? ['view-terms']), ...tracked, ...evidenced].sort(),
      );
    },
  );

  it('never lists the same action twice, and gives every row words', () => {
    for (const status of WORKSPACE_STATUSES) {
      for (const role of ROLES) {
        const rows = tradeActions(status, role, ID);
        expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
        for (const row of rows) {
          expect(row.title.length).toBeGreaterThan(0);
          expect(row.description.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps each side's actions to that side: the buyer funds and confirms, the seller ships", () => {
    const ids = (status: (typeof WORKSPACE_STATUSES)[number], role: TradeRole) =>
      tradeActions(status, role, ID).map((row) => row.id);
    expect(ids('PENDING_PAYMENT', 'BUYER')).toContain('fund');
    expect(ids('PENDING_PAYMENT', 'SELLER')).not.toContain('fund');
    expect(tradeActions('PENDING_PAYMENT', 'BUYER', ID).find((row) => row.id === 'fund')).toMatchObject({
      availability: 'live',
      href: `/trade/${ID}/fund`,
    });
    expect(ids('FUNDED', 'SELLER')).toContain('ship');
    expect(ids('FUNDED', 'BUYER')).not.toContain('ship');
    expect(ids('INSPECTION', 'BUYER')).toEqual(
      expect.arrayContaining(['accept', 'more-time', 'report-issue']),
    );
    expect(ids('INSPECTION', 'SELLER')).not.toContain('accept');
    expect(ids('INSPECTION', 'SELLER')).toContain('answer-extension');
  });

  it('points each live delivery and inspection action at the screen that does it', () => {
    const href = (status: (typeof WORKSPACE_STATUSES)[number], role: TradeRole, id: string) =>
      tradeActions(status, role, ID).find((row) => row.id === id)?.href;
    expect(href('INSPECTION', 'BUYER', 'accept')).toBe(`/trade/${ID}/inspect`);
    expect(href('INSPECTION', 'BUYER', 'more-time')).toBe(`/trade/${ID}/inspect`);
    expect(href('INSPECTION', 'SELLER', 'answer-extension')).toBe(`/trade/${ID}/inspect`);
    expect(href('FUNDED', 'SELLER', 'ask-more-time')).toBe(`/trade/${ID}/extend`);
    expect(href('SHIPPED', 'BUYER', 'confirm-delivery')).toBe(`/trade/${ID}`);
  });

  it('says plainly that a step is not in the app yet, instead of offering a control that does nothing', () => {
    const later = tradeActions('FUNDED', 'SELLER', ID).filter((row) => row.availability === 'later');
    expect(later.length).toBeGreaterThan(0);
    for (const row of later) expect(row.href).toBeUndefined();
  });

  it('does not offer a release by hand, only a note that it follows an outcome', () => {
    const release = tradeActions('INSPECTION', 'BUYER', ID).find((row) => row.id === 'release');
    expect(release?.availability).toBe('guarded');
    expect(tradeActions('PENDING_PAYMENT', 'BUYER', ID).some((row) => row.id === 'release')).toBe(false);
  });

  it.each([
    'SETTLED',
    'RESOLVED_RELEASED',
    'RESOLVED_REFUNDED',
    'CANCELLED_REFUNDED',
    'PENDING_PAYMENT',
  ] as const)('does not talk about guarding the funds on %s, when none are held', (status) => {
    for (const role of ROLES) {
      expect(
        tradeActions(status, role, ID).some((row) => row.id === 'release'),
        `${status} ${role}`,
      ).toBe(false);
    }
  });

  it.each(['FUNDED', 'SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION', 'DISPUTED', 'COMPLETED'] as const)(
    'does say the funds are guarded while Komtru holds them (%s)',
    (status) => {
      expect(tradeActions(status, 'BUYER', ID).some((row) => row.id === 'release')).toBe(true);
    },
  );

  it('does not offer a withdrawal once the trade has been paid for', () => {
    for (const status of WORKSPACE_STATUSES.filter((s) => s !== 'PENDING_PAYMENT')) {
      for (const role of ROLES) {
        expect(
          tradeActions(status, role, ID).some((row) => row.id === 'cancel'),
          `${status} ${role}`,
        ).toBe(false);
      }
    }
  });
});

describe('the tab list, which later features extend', () => {
  it('has a unique id, label and title for every tab, starting with the overview', () => {
    const ids = WORKSPACE_TAB_DEFS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('overview');
    for (const tab of WORKSPACE_TAB_DEFS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.title.length).toBeGreaterThan(0);
    }
  });

  it('recognises exactly the tabs in the list, so a route cannot invent one', () => {
    for (const tab of WORKSPACE_TABS) expect(isWorkspaceTab(tab)).toBe(true);
    for (const wrong of ['', 'Terms', 'payments', '../terms', 'counter'])
      expect(isWorkspaceTab(wrong)).toBe(false);
    expect(tabTitle('activity')).toBe('Trade Activity');
  });
});

describe('the activity wording', () => {
  const item = (over: Partial<TradeActivityItem> = {}): TradeActivityItem => ({
    id: 'S:1',
    occurredAt: '2026-09-30T12:24:00.000Z',
    kind: 'FUNDS_PROTECTED',
    actor: 'KOMTRU',
    toStatus: 'FUNDED',
    reason: null,
    ...over,
  });

  it('has a title for every kind the platform can send', () => {
    for (const kind of TRADE_ACTIVITY_KINDS) {
      expect(describeActivity(item({ kind }), 'BUYER').title.length, kind).toBeGreaterThan(0);
    }
  });

  it("names the actor from the reader's side", () => {
    expect(actorLabel('YOU', 'BUYER')).toBe('You');
    expect(actorLabel('OTHER_PARTY', 'BUYER')).toBe('The seller');
    expect(actorLabel('OTHER_PARTY', 'SELLER')).toBe('The buyer');
    expect(actorLabel('KOMTRU', 'SELLER')).toBe('Komtru');
  });

  it('says the buyer accepted the item only of a step a party took, never of one Komtru took', () => {
    const byParty = describeActivity(item({ kind: 'TRADE_COMPLETED', actor: 'OTHER_PARTY' }), 'SELLER');
    expect(byParty.detail).toContain('The buyer accepted the item');
    const byKomtru = describeActivity(item({ kind: 'TRADE_COMPLETED', actor: 'KOMTRU' }), 'SELLER');
    expect(byKomtru.detail.join(' ')).not.toContain('accepted');
  });

  it('says what only Komtru does only of Komtru', () => {
    expect(
      describeActivity(item({ kind: 'DELIVERY_ASSUMED', actor: 'KOMTRU' }), 'BUYER').detail.join(' '),
    ).toContain('did not answer');
    expect(
      describeActivity(item({ kind: 'DELIVERY_ASSUMED', actor: 'OTHER_PARTY' }), 'BUYER').detail.join(' '),
    ).not.toContain('did not answer');
  });

  it('adds the reason a party gave, and only that', () => {
    const declined = describeActivity(
      item({ kind: 'PROPOSAL_DECLINED', actor: 'OTHER_PARTY', reason: 'Too expensive' }),
      'BUYER',
    );
    expect(declined.detail).toEqual(['The seller', 'Reason: Too expensive']);
    expect(describeActivity(item(), 'BUYER').detail.join(' ')).not.toContain('Reason');
  });
});

describe('whenLabel', () => {
  it('writes a moment as the reference does, in Lagos time whatever the device says', () => {
    expect(whenLabel('2026-09-30T12:24:00.000Z')).toBe('30 Sep · 13:24');
    expect(whenLabel('2026-11-09T23:30:00.000000Z')).toBe('10 Nov · 00:30');
  });

  it('says nothing for a value that is not a date', () => {
    expect(whenLabel('not a date')).toBe('');
  });
});
