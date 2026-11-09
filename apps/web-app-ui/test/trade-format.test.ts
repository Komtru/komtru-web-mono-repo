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
  nairaShort,
  partyName,
  problemMessage,
  proofNeeds,
} from '../src/trade/format';

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
  const base = { tradeCode: 'KMT-9013800-NG', attention: null } as const;

  it('marks a held proposal Verification Needed, as Q1 draws it', () => {
    expect(describeTrade({ ...base, status: 'UNDER_PROPOSAL_REVIEW' })).toMatchObject({
      tone: 'verifying',
      label: 'Verification Needed',
    });
  });

  it("words the server's attention and never decides it", () => {
    expect(
      describeTrade({ ...base, status: 'AWAITING_ACCEPTANCE', attention: 'RESPOND_TO_PROPOSAL' }).label,
    ).toBe('Your answer');
    expect(describeTrade({ ...base, status: 'PENDING_PAYMENT', attention: 'PAY' }).label).toBe('Payment due');
    // A proposal that is the other party's turn is "Sent" whatever the status says about turns.
    expect(describeTrade({ ...base, status: 'AWAITING_ACCEPTANCE' }).label).toBe('Sent');
  });

  it.each(['DECLINED', 'REJECTED', 'CANCELLED', 'EXPIRED'] as const)('treats %s as closed', (status) => {
    expect(describeTrade({ ...base, status }).closed).toBe(true);
  });

  it('shows a status it has never heard of as in progress rather than hiding the trade', () => {
    expect(describeTrade({ ...base, status: 'SOMETHING_NEW' as never })).toMatchObject({
      label: 'In progress',
      closed: false,
    });
  });
});

describe('partyName', () => {
  const party = { publicId: 'U', username: null, displayName: null, avatarUrl: null };
  it('prefers the display name, then the handle, and guesses nothing else', () => {
    expect(partyName({ ...party, displayName: 'Amaka B.', username: 'amaka' })).toBe('Amaka B.');
    expect(partyName({ ...party, username: 'amaka' })).toBe('@amaka');
    expect(partyName(party)).toBe('A Komtru member');
  });
});

describe('proofNeeds', () => {
  it("is the platform's own rule: minPhotos raises the bar and cannot lower it below one piece of media", () => {
    expect(proofNeeds({ minPhotos: 3, requireVideo: false })).toEqual({ photos: 3, video: false });
    expect(proofNeeds({ minPhotos: 0, requireVideo: false })).toEqual({ photos: 1, video: false });
  });

  it('asks for no photo at all when a video stands in for them, and for both when both are set', () => {
    expect(proofNeeds({ minPhotos: 0, requireVideo: true })).toEqual({ photos: 0, video: true });
    expect(proofNeeds({ minPhotos: 4, requireVideo: true })).toEqual({ photos: 4, video: true });
  });
});
