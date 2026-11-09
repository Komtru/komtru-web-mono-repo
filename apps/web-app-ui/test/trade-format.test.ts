// @vitest-environment jsdom
import { ProblemError, type ResponseMeta } from '@komtru/api-client';
import { describe, expect, it } from 'vitest';
import {
  addressLine,
  describeTrade,
  hoursLabel,
  initialsOf,
  itemSub,
  itemTitle,
  naira,
  problemMessage,
} from '../src/trade/format';
import { forgetKnownTrades, knownTradeIds, rememberTrade } from '../src/trade/known-trades';

const meta: ResponseMeta = {
  status: 422,
  requestId: undefined,
  replayed: false,
  retryAfterMs: undefined,
  rateLimit: undefined,
};
const problem = (code: string, detail?: string) =>
  new ProblemError(
    {
      type: 'about:blank',
      title: 'Title that may be reworded',
      status: 422,
      code,
      ...(detail ? { detail } : {}),
    },
    meta,
    false,
  );

describe('naira', () => {
  it('formats kobo exactly, with kobo shown, and never touches a float', () => {
    expect(naira('45200000')).toBe('₦452,000.00');
    expect(naira('9007199254740993')).toBe('₦90,071,992,547,409.93');
  });
});

describe('problemMessage', () => {
  it('speaks from the code, not the title', () => {
    expect(problemMessage(problem('MERCHANT_CANNOT_BUY'), 'x')).toContain("can't be the buyer");
    expect(problemMessage(problem('ADDRESS_REQUIRED'), 'x')).toBe('Choose or add a saved address first.');
  });

  it("passes on the backend's detail for a code it has nothing specific for, and the fallback otherwise", () => {
    expect(
      problemMessage(
        problem('VALIDATION_FAILED', 'Attach 2 more photos before this trade can move to payment.'),
        'x',
      ),
    ).toBe('Attach 2 more photos before this trade can move to payment.');
    expect(problemMessage(problem('VALIDATION_FAILED'), 'We could not send that.')).toBe(
      'We could not send that.',
    );
    expect(problemMessage(new TypeError('offline'), 'We could not send that.')).toBe(
      'We could not send that.',
    );
  });
});

describe('item wording', () => {
  it('titles an item by brand and model and describes it with the rest, in the order typed', () => {
    const spec = { brand: 'Apple', model: 'iPhone 13 Pro', condition: 'Sealed box', storage: 256 };
    expect(itemTitle(spec)).toBe('Apple iPhone 13 Pro');
    expect(itemSub(spec)).toBe('Sealed box · 256');
  });

  it('falls back when nothing was described, and survives a spec that is not an object', () => {
    expect(itemTitle({}, 'Electronics')).toBe('Electronics');
    expect(itemTitle(null)).toBe('Item');
    expect(itemSub('nonsense')).toBeUndefined();
  });
});

describe('small formatters', () => {
  it('takes two initials', () => {
    expect(initialsOf('Prime Gadgets')).toBe('PG');
    expect(initialsOf('amaka')).toBe('A');
  });

  it('reads an address snapshot as street then landmark', () => {
    expect(addressLine({ street: '12 Allen Ave', landmark: 'Opposite the mall' })).toBe(
      '12 Allen Ave, Opposite the mall',
    );
    expect(addressLine({ street: '12 Allen Ave', landmark: '' })).toBe('12 Allen Ave');
    expect(addressLine(null)).toBe('No address on this version');
  });

  it('says whole days as days', () => {
    expect(hoursLabel(48)).toBe('2 days');
    expect(hoursLabel(24)).toBe('1 day');
    expect(hoursLabel(36)).toBe('36 hours');
  });
});

describe('describeTrade', () => {
  const base = { tradeCode: 'KMT-90138', yourRole: 'BUYER', initiatorRole: 'BUYER', awaiting: null } as const;

  it('marks a held proposal as Verification Needed for the person who proposed it, as Q1 draws it', () => {
    expect(describeTrade({ ...base, status: 'UNDER_PROPOSAL_REVIEW' })).toMatchObject({
      tone: 'verifying',
      label: 'Verification needed',
      needsYou: true,
    });
  });

  it('is waiting on you only when the backend says awaiting YOU', () => {
    expect(describeTrade({ ...base, status: 'AWAITING_ACCEPTANCE', awaiting: 'YOU' }).needsYou).toBe(true);
    expect(describeTrade({ ...base, status: 'AWAITING_ACCEPTANCE', awaiting: 'COUNTERPARTY' }).needsYou).toBe(
      false,
    );
  });

  it.each(['DECLINED', 'REJECTED', 'CANCELLED', 'EXPIRED'])('treats %s as closed', (status) => {
    expect(describeTrade({ ...base, status }).closed).toBe(true);
  });

  it('shows a status it has never heard of as in progress rather than hiding the trade', () => {
    expect(describeTrade({ ...base, status: 'SOMETHING_NEW' })).toMatchObject({
      label: 'In progress',
      closed: false,
    });
  });
});

describe('known trades', () => {
  it('remembers ids newest first, once each, and forgets them on request', () => {
    window.localStorage.clear();
    rememberTrade('a');
    rememberTrade('b');
    rememberTrade('a');
    expect(knownTradeIds()).toEqual(['a', 'b']);
    forgetKnownTrades();
    expect(knownTradeIds()).toEqual([]);
  });

  it('reads a corrupted store as empty', () => {
    window.localStorage.setItem('komtru.trades.known', '{not json');
    expect(knownTradeIds()).toEqual([]);
  });
});
