import {
  TRADE_ACTIONS,
  TRADE_ACTIVITY_KINDS,
  tradeActivityItemSchema,
  type TradeActivityKind,
} from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_EVENT_KIND,
  readTradeActivityCursor,
  toActivityItem,
  tradeActivityCursor,
  type ActivityRow,
  type ActivityViewer,
} from '../../../../src/modules/trades/domain/tradeActivity.js';
import { decodeCursor, encodeCursor } from '../../../../src/platform/http/paginate.js';

const TRADE = '0190b0a0-0000-7000-8000-000000000001';
const buyer: ActivityViewer = { role: 'BUYER', isInitiator: false };
const initiator: ActivityViewer = { role: 'SELLER', isInitiator: true };

const state = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  src: 'S',
  n: '7',
  occurredAt: '2026-11-09T10:00:00.123456Z',
  cursorTs: '2026-11-09T10:00:00.123456Z',
  actorType: 'SELLER',
  action: 'ACCEPT',
  toStatus: 'PENDING_PAYMENT',
  reason: null,
  event: null,
  ...over,
});

describe('which label a row has', () => {
  it('has a label for every action the state machine can take, and every label is a published one', () => {
    for (const action of TRADE_ACTIONS) {
      const item = toActivityItem(state({ action, toStatus: 'FUNDED' }), initiator);
      expect(item, action).not.toBeNull();
      expect(TRADE_ACTIVITY_KINDS).toContain(item?.kind);
    }
  });

  it('maps every allowlisted activity event to a published label', () => {
    for (const [event, kind] of Object.entries(ACTIVITY_EVENT_KIND)) {
      const item = toActivityItem(
        state({ src: 'A', n: '2', actorType: 'BUYER', action: null, toStatus: null, event }),
        buyer,
      );
      expect(item?.kind).toBe(kind satisfies TradeActivityKind);
    }
  });

  it('drops an activity row whose event is not on the allowlist, or has none', () => {
    const base = { src: 'A', n: '2', action: null, toStatus: null } as const;
    expect(toActivityItem(state({ ...base, event: 'SOMETHING_INTERNAL' }), buyer)).toBeNull();
    expect(toActivityItem(state({ ...base, event: null }), buyer)).toBeNull();
  });
});

describe('who did it, from the reader', () => {
  it.each([
    ['BUYER', 'YOU'],
    ['SELLER', 'OTHER_PARTY'],
  ])('shows a %s action to a buyer as %s', (actorType, actor) => {
    expect(toActivityItem(state({ actorType }), buyer)?.actor).toBe(actor);
  });

  it.each(['SYSTEM', 'LEDGER', 'STAFF', 'LOGISTICS'])(
    'collapses %s into one KOMTRU, so staff is not told apart',
    (actorType) => {
      expect(toActivityItem(state({ actorType, action: 'FUND', toStatus: 'FUNDED' }), buyer)?.actor).toBe(
        'KOMTRU',
      );
    },
  );
});

describe('what a party may read of a reason', () => {
  const declined = { action: 'DECLINE', toStatus: 'DECLINED', reason: ' Changed my mind ' } as const;

  it("shows the other party's decline reason, trimmed, because the decline sheet promised it", () => {
    expect(toActivityItem(state({ ...declined, actorType: 'SELLER' }), buyer)?.reason).toBe(
      'Changed my mind',
    );
  });

  it('shows a cancellation reason a party wrote', () => {
    expect(
      toActivityItem(
        state({ action: 'CANCEL', toStatus: 'CANCELLED', reason: 'Wrong item', actorType: 'BUYER' }),
        buyer,
      )?.reason,
    ).toBe('Wrong item');
  });

  it.each(['STAFF', 'SYSTEM', 'LEDGER', 'LOGISTICS'])(
    'never shows a reason written by %s, whatever the action',
    (actorType) => {
      for (const action of ['DECLINE', 'CANCEL', 'RESOLVE_DISPUTE', 'REFUND_CANCELLATION', 'REJECT_REVIEW']) {
        const item = toActivityItem(
          state({ actorType, action, reason: 'fraud ring, see case 88213' }),
          initiator,
        );
        expect(item?.reason ?? null, `${actorType} ${action}`).toBeNull();
      }
    },
  );

  it('shows no party reason on an action that is not a decline or a cancellation', () => {
    expect(
      toActivityItem(state({ action: 'DISPUTE', toStatus: 'DISPUTED', reason: 'it is broken' }), buyer)
        ?.reason,
    ).toBeNull();
  });

  it('bounds a long reason', () => {
    const item = toActivityItem(state({ ...declined, reason: 'x'.repeat(2000) }), buyer);
    expect(item?.reason).toHaveLength(500);
  });
});

describe('what only the proposer may see of a review', () => {
  const held = { action: 'SEND', toStatus: 'UNDER_PROPOSAL_REVIEW', actorType: 'SELLER' } as const;
  const rejected = {
    action: 'REJECT_REVIEW',
    toStatus: 'REJECTED',
    actorType: 'STAFF',
    reason: 'risk rule 12',
  } as const;

  it('tells the proposer a proposal is held, and the other party nothing', () => {
    expect(toActivityItem(state(held), initiator)?.kind).toBe('PROPOSAL_HELD');
    expect(toActivityItem(state(held), buyer)).toBeNull();
  });

  it('tells the proposer it was not sent, without the staff reason, and the other party nothing', () => {
    const item = toActivityItem(state(rejected), initiator);
    expect(item?.kind).toBe('PROPOSAL_NOT_SENT');
    expect(item?.reason).toBeNull();
    expect(toActivityItem(state(rejected), buyer)).toBeNull();
  });

  it('shows both parties a cleared review as an ordinary send', () => {
    for (const viewer of [buyer, initiator]) {
      expect(
        toActivityItem(
          state({ action: 'CLEAR_REVIEW', toStatus: 'AWAITING_ACCEPTANCE', actorType: 'STAFF' }),
          viewer,
        )?.kind,
      ).toBe('PROPOSAL_SENT');
    }
  });
});

describe('what a row exposes', () => {
  it('is exactly the published shape: no actor id, metadata or summary can ride along', () => {
    const item = toActivityItem(state(), buyer);
    expect(tradeActivityItemSchema.safeParse(item).success).toBe(true);
    expect(Object.keys(item ?? {}).sort()).toEqual([
      'actor',
      'id',
      'kind',
      'occurredAt',
      'reason',
      'toStatus',
    ]);
  });

  it('gives a state change its status and an activity row none', () => {
    expect(toActivityItem(state(), buyer)?.toStatus).toBe('PENDING_PAYMENT');
    expect(
      toActivityItem(
        state({ src: 'A', toStatus: 'FUNDED', action: null, event: 'EXTENSION_REQUESTED' }),
        buyer,
      )?.toStatus,
    ).toBeNull();
  });
});

describe('the cursor', () => {
  const key = (over: Record<string, unknown> = {}) => ({
    t: '2026-11-09T10:00:00.123456Z',
    id: 'S:7',
    f: TRADE,
    ...over,
  });
  const reject = (cursor: Record<string, string | number | null>, trade = TRADE) =>
    expect(() => readTradeActivityCursor(cursor, trade)).toThrowError(
      expect.objectContaining({ status: 422, code: 'VALIDATION_FAILED' }) as Error,
    );

  it('reads back what it made, for the same trade', () => {
    const made = tradeActivityCursor({ src: 'A', n: '41', cursorTs: '2026-11-09T10:00:00.123456Z' }, TRADE);
    expect(readTradeActivityCursor(decodeCursor(encodeCursor(made)), TRADE)).toEqual({
      ts: '2026-11-09T10:00:00.123456Z',
      src: 'A',
      n: '41',
    });
  });

  it('is undefined for no cursor', () => {
    expect(readTradeActivityCursor(undefined, TRADE)).toBeUndefined();
  });

  it.each([
    ['a time with milliseconds only', key({ t: '2026-11-09T10:00:00.123Z' })],
    ['a time with no zone', key({ t: '2026-11-09T10:00:00.123456' })],
    ['an impossible time', key({ t: '2026-13-45T10:00:00.123456Z' })],
    ['a numeric id', key({ id: 7 })],
    ['an unknown source', key({ id: 'X:7' })],
    ['a non-numeric id', key({ id: 'S:seven' })],
    ['an id with a sign', key({ id: 'S:-7' })],
    ['a trade filter that is not a uuid', key({ f: 'ALL' })],
    ['another trade', key({ f: '0190b0a0-0000-7000-8000-000000000002' })],
    ['an extra field', key({ extra: 'x' })],
    ['a missing field', { t: '2026-11-09T10:00:00.123456Z', id: 'S:7' }],
    ['a trades-list cursor', { t: '2026-11-09T10:00:00.123456Z', id: TRADE, f: 'ALL' }],
  ])('is a 422, never page one, for %s', (_name, cursor) => {
    reject(cursor);
  });
});
