// @vitest-environment jsdom
import { ProblemError, type ResponseMeta } from '@komtru/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addressLine,
  describeTrade,
  hoursLabel,
  initialsOf,
  itemSub,
  itemTitle,
  naira,
  nairaShort,
  problemMessage,
  proofRequired,
} from '../src/trade/format';
import { forgetKnownTrades, forgetTrade, knownTradeIds, rememberTrade } from '../src/trade/known-trades';

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

describe('nairaShort', () => {
  it('drops the kobo when there are none, as the trades list writes an amount, and keeps them when there are', () => {
    expect(nairaShort('145000000')).toBe('₦1,450,000');
    expect(nairaShort('145000050')).toBe('₦1,450,000.50');
  });
});

describe('problemMessage', () => {
  it('speaks from the code, not the title', () => {
    expect(problemMessage(problem('MERCHANT_CANNOT_BUY'), 'x')).toContain("can't be the buyer");
    expect(problemMessage(problem('ADDRESS_REQUIRED'), 'x')).toBe('Choose or add a saved address first.');
  });

  it('says the terms changed for the 409 a stale revision or stale version produces', () => {
    expect(problemMessage(problem('CONFLICT', 'The trade moved on'), 'x')).toContain(
      'The terms changed while you were looking',
    );
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

  it('states a window in hours, as the standards are set', () => {
    expect(hoursLabel(48)).toBe('48 hours');
    expect(hoursLabel(24)).toBe('24 hours');
    expect(hoursLabel(1)).toBe('1 hour');
  });
});

describe('describeTrade', () => {
  const base = { tradeCode: 'KMT-90138', yourRole: 'BUYER', initiatorRole: 'BUYER', awaiting: null } as const;

  it('marks a held proposal as Verification Needed for the person who proposed it, as Q1 draws it', () => {
    expect(describeTrade({ ...base, status: 'UNDER_PROPOSAL_REVIEW' })).toMatchObject({
      tone: 'verifying',
      label: 'Verification Needed',
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
  const ADA = 'user-ada';
  const BOLA = 'user-bola';
  const key = (user: string) => `komtru.trades.known.${user}`;

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('remembers ids newest first, once each', () => {
    rememberTrade(ADA, 'a');
    rememberTrade(ADA, 'b');
    rememberTrade(ADA, 'a');
    expect(knownTradeIds(ADA)).toEqual(['a', 'b']);
  });

  it("keeps each person's list apart, so a second person on the phone sees none of the first's", () => {
    rememberTrade(ADA, 'a');
    expect(knownTradeIds(BOLA)).toEqual([]);
    rememberTrade(BOLA, 'b');
    expect(knownTradeIds(ADA)).toEqual(['a']);
  });

  it('keeps the newest hundred and drops the rest', () => {
    for (let n = 0; n < 105; n += 1) rememberTrade(ADA, `t${String(n)}`);
    const ids = knownTradeIds(ADA);
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('t104');
    expect(ids).not.toContain('t4');
  });

  it('forgets one id that can never be read again, and only that one', () => {
    rememberTrade(ADA, 'a');
    rememberTrade(ADA, 'b');
    forgetTrade(ADA, 'a');
    expect(knownTradeIds(ADA)).toEqual(['b']);
  });

  it("clears every person's list on sign-out, and the unscoped key an earlier build wrote", () => {
    rememberTrade(ADA, 'a');
    rememberTrade(BOLA, 'b');
    window.localStorage.setItem('komtru.trades.known', JSON.stringify(['old']));
    window.localStorage.setItem('unrelated', 'kept');
    forgetKnownTrades();
    expect(window.localStorage.getItem(key(ADA))).toBeNull();
    expect(window.localStorage.getItem(key(BOLA))).toBeNull();
    expect(window.localStorage.getItem('komtru.trades.known')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('kept');
  });

  it('reads corrupted or wrongly shaped storage as empty', () => {
    window.localStorage.setItem(key(ADA), '{not json');
    expect(knownTradeIds(ADA)).toEqual([]);
    window.localStorage.setItem(key(ADA), JSON.stringify({ not: 'a list' }));
    expect(knownTradeIds(ADA)).toEqual([]);
    window.localStorage.setItem(key(ADA), JSON.stringify(['ok', 7, null]));
    expect(knownTradeIds(ADA)).toEqual(['ok']);
  });
});

describe('proofRequired', () => {
  const standard = (categoryCode: string, required: string[], minPhotos: number) =>
    ({
      versionId: 'v',
      categoryCode,
      categoryName: categoryCode,
      versionNumber: 1,
      createdAt: '',
      inspectionWindowHours: 24,
      itemSpecFields: required.map((key) => ({ key, label: key, required: true })),
      proofMedia: { minPhotos, requireVideo: false },
      imeiVerification: false,
      deliveryDeadlineDays: 7,
    }) as const;
  const standards = [
    standard('electronics', ['brand', 'model'], 3),
    standard('fashion', ['brand', 'size'], 2),
  ];

  it("asks what the item's own category asks, recognised by the details it carries", () => {
    expect(proofRequired({ brand: 'Apple', model: 'iPhone' }, standards)).toBe(3);
    expect(proofRequired({ brand: 'Zara', size: 'M' }, standards)).toBe(2);
  });

  it('takes the strictest when the details fit more than one category, never less than one', () => {
    expect(proofRequired({ brand: 'X', model: 'Y', size: 'Z' }, standards)).toBe(3);
    expect(proofRequired({}, standards)).toBe(3);
    expect(proofRequired({}, [])).toBe(1);
    expect(proofRequired({ brand: 'a' }, [standard('x', ['brand'], 0)])).toBe(1);
  });
});
