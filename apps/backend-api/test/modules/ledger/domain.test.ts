// The ledger's pure half: how an account is named, which way each account's balance runs, and the
// balance check a caller hits before the database does. No infrastructure.
import { koboSchema } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import {
  accountKey,
  accountRefSchema,
  assertBalanced,
  journalIdempotencyKeySchema,
  LEDGER_ACCOUNT_TYPES,
  ledgerJournalPostedEvent,
  MAX_JOURNAL_LINES,
  normalBalance,
  postJournalInputSchema,
  signedMinor,
  UnbalancedJournalError,
  type JournalLineInput,
} from '../../../src/modules/ledger/index.js';

const OWNER = '2f0a4c8e-1d3b-4a5f-9c7e-8b6d5a4f3e2c';
const TRADE = '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const PAYOUT = '9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f';

const line = (overrides: Partial<JournalLineInput> = {}): JournalLineInput => ({
  account: { type: 'PLATFORM_ESCROW_POOL' },
  direction: 'DEBIT',
  amountMinor: 10_000n,
  ...overrides,
});

describe('ledger account identity', () => {
  it('names a scoped account from its type, currency and scope', () => {
    expect(accountKey({ type: 'USER_PAYABLE', ownerUserId: OWNER })).toBe(`NGN:USER_PAYABLE:${OWNER}`);
    expect(accountKey({ type: 'USER_ESCROW_LIABILITY', tradeId: TRADE })).toBe(
      `NGN:USER_ESCROW_LIABILITY:${TRADE}`,
    );
    expect(accountKey({ type: 'SETTLEMENT_CLEARING', payoutId: PAYOUT })).toBe(
      `NGN:SETTLEMENT_CLEARING:${PAYOUT}`,
    );
  });

  it('names a platform account with no scope at all', () => {
    expect(accountKey({ type: 'PLATFORM_ESCROW_POOL' })).toBe('NGN:PLATFORM_ESCROW_POOL:-');
    expect(accountKey({ type: 'BUYER_PROTECTION_FEE_REVENUE' })).toBe('NGN:BUYER_PROTECTION_FEE_REVENUE:-');
  });

  it('gives a second currency its own accounts', () => {
    expect(accountKey({ type: 'PLATFORM_ESCROW_POOL' }, 'USD')).toBe('USD:PLATFORM_ESCROW_POOL:-');
  });

  it('refuses to name a payable with no owner', () => {
    expect(accountRefSchema.safeParse({ type: 'USER_PAYABLE' }).success).toBe(false);
  });

  it('refuses to name an escrow liability with a user instead of a trade', () => {
    expect(accountRefSchema.safeParse({ type: 'USER_ESCROW_LIABILITY', ownerUserId: OWNER }).success).toBe(
      false,
    );
  });

  it('refuses a scope that is not a uuid', () => {
    expect(accountRefSchema.safeParse({ type: 'USER_PAYABLE', ownerUserId: 'bob' }).success).toBe(false);
    expect(() => accountKey({ type: 'USER_PAYABLE', ownerUserId: 'bob' })).toThrow();
  });

  it('normalises a uuid the way Postgres stores it', () => {
    expect(accountKey({ type: 'USER_PAYABLE', ownerUserId: OWNER.toUpperCase() })).toBe(
      `NGN:USER_PAYABLE:${OWNER}`,
    );
    expect(accountKey({ type: 'USER_PAYABLE', ownerUserId: ` ${OWNER} ` })).toBe(`NGN:USER_PAYABLE:${OWNER}`);
  });

  it('refuses a currency that is not a three-letter code', () => {
    expect(() => accountKey({ type: 'PLATFORM_ESCROW_POOL' }, 'ngn')).toThrow();
  });

  it('lists the six account types M8 §4 and T-070 define', () => {
    expect(LEDGER_ACCOUNT_TYPES).toEqual([
      'PLATFORM_ESCROW_POOL',
      'USER_ESCROW_LIABILITY',
      'USER_PAYABLE',
      'PLATFORM_FEE_REVENUE',
      'BUYER_PROTECTION_FEE_REVENUE',
      'SETTLEMENT_CLEARING',
    ]);
  });
});

describe('ledger account nature', () => {
  it('runs the only asset on the debit side', () => {
    expect(normalBalance('PLATFORM_ESCROW_POOL')).toBe('DEBIT');
  });

  it('runs liabilities and revenue on the credit side', () => {
    expect(normalBalance('USER_ESCROW_LIABILITY')).toBe('CREDIT');
    expect(normalBalance('USER_PAYABLE')).toBe('CREDIT');
    expect(normalBalance('PLATFORM_FEE_REVENUE')).toBe('CREDIT');
    expect(normalBalance('BUYER_PROTECTION_FEE_REVENUE')).toBe('CREDIT');
  });

  // M8 §5's table calls this an asset; M8 §4's postings credit it on payout initiation and debit it
  // on confirmation, with the cash leaving the pool only at confirmation. The postings balance and
  // the label does not, so the postings win: clearing is an in-flight obligation.
  it('runs settlement clearing on the credit side, as M8 §4 posts it', () => {
    expect(normalBalance('SETTLEMENT_CLEARING')).toBe('CREDIT');
  });

  it('signs an amount against the account’s own nature', () => {
    expect(signedMinor('PLATFORM_ESCROW_POOL', 'DEBIT', 100n)).toBe(100n);
    expect(signedMinor('PLATFORM_ESCROW_POOL', 'CREDIT', 100n)).toBe(-100n);
    expect(signedMinor('USER_PAYABLE', 'CREDIT', 100n)).toBe(100n);
    expect(signedMinor('USER_PAYABLE', 'DEBIT', 100n)).toBe(-100n);
  });
});

describe('assertBalanced', () => {
  it('accepts a two-line posting whose debits equal its credits', () => {
    expect(() =>
      assertBalanced([
        line(),
        line({ account: { type: 'USER_ESCROW_LIABILITY', tradeId: TRADE }, direction: 'CREDIT' }),
      ]),
    ).not.toThrow();
  });

  it('accepts a split credit that sums to the debit', () => {
    expect(() =>
      assertBalanced([
        line({ account: { type: 'USER_ESCROW_LIABILITY', tradeId: TRADE }, amountMinor: 5_000_000n }),
        line({
          account: { type: 'USER_PAYABLE', ownerUserId: OWNER },
          direction: 'CREDIT',
          amountMinor: 4_750_000n,
        }),
        line({ account: { type: 'PLATFORM_FEE_REVENUE' }, direction: 'CREDIT', amountMinor: 250_000n }),
      ]),
    ).not.toThrow();
  });

  it('rejects a line set whose debits and credits differ, reporting both sums', () => {
    let thrown: unknown;
    try {
      assertBalanced([
        line({ amountMinor: 10_000n }),
        line({
          account: { type: 'USER_ESCROW_LIABILITY', tradeId: TRADE },
          direction: 'CREDIT',
          amountMinor: 9_999n,
        }),
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnbalancedJournalError);
    expect((thrown as UnbalancedJournalError).debitsMinor).toBe(10_000n);
    expect((thrown as UnbalancedJournalError).creditsMinor).toBe(9_999n);
  });

  it('rejects a single-line journal', () => {
    expect(() => assertBalanced([line()])).toThrow(UnbalancedJournalError);
  });

  it('rejects a journal that is all debits', () => {
    expect(() => assertBalanced([line(), line()])).toThrow(UnbalancedJournalError);
  });
});

describe('postJournalInputSchema', () => {
  const base = {
    idempotencyKey: 'trade:7a1b2c3d:release',
    description: 'escrow funded',
    lines: [
      line(),
      line({ account: { type: 'USER_ESCROW_LIABILITY', tradeId: TRADE }, direction: 'CREDIT' }),
    ],
  };

  it('accepts a well-formed posting', () => {
    expect(postJournalInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a zero or negative amount', () => {
    expect(
      postJournalInputSchema.safeParse({ ...base, lines: [line({ amountMinor: 0n }), line()] }).success,
    ).toBe(false);
    expect(
      postJournalInputSchema.safeParse({ ...base, lines: [line({ amountMinor: -1n }), line()] }).success,
    ).toBe(false);
  });

  it('rejects an amount past the bigint range', () => {
    const tooBig = 9_223_372_036_854_775_808n;
    expect(
      postJournalInputSchema.safeParse({ ...base, lines: [line({ amountMinor: tooBig }), line()] }).success,
    ).toBe(false);
  });

  it('rejects an amount that is a number rather than kobo', () => {
    expect(
      postJournalInputSchema.safeParse({ ...base, lines: [{ ...line(), amountMinor: 100 }, line()] }).success,
    ).toBe(false);
  });

  it('rejects fewer than two lines', () => {
    expect(postJournalInputSchema.safeParse({ ...base, lines: [line()] }).success).toBe(false);
  });

  it('rejects a posting with more lines than a posting has', () => {
    const many = Array.from({ length: MAX_JOURNAL_LINES + 1 }, () => line());
    expect(postJournalInputSchema.safeParse({ ...base, lines: many }).success).toBe(false);
  });

  it('rejects an idempotency key with no namespace prefix', () => {
    expect(journalIdempotencyKeySchema.safeParse('abc123').success).toBe(false);
    expect(journalIdempotencyKeySchema.safeParse('Trade:1').success).toBe(false);
    expect(journalIdempotencyKeySchema.safeParse('trade:7a1b2c3d:release').success).toBe(true);
  });

  it('rejects a provider without its reference', () => {
    expect(postJournalInputSchema.safeParse({ ...base, provider: 'PAYSTACK' }).success).toBe(false);
  });

  it('rejects a currency that is not three upper-case letters', () => {
    expect(postJournalInputSchema.safeParse({ ...base, currency: 'ngn' }).success).toBe(false);
  });
});

describe('ledgerJournalPostedEvent', () => {
  it('is a versioned ledger event carrying amounts as digit strings', () => {
    expect(ledgerJournalPostedEvent.eventType).toBe('ledger.journal.posted');
    expect(ledgerJournalPostedEvent.version).toBe(1);
    const parsed = ledgerJournalPostedEvent.payload.parse({
      journalEntryId: TRADE,
      idempotencyKey: 'trade:1:release',
      description: 'release',
      currency: 'NGN',
      postedAt: '2026-10-05T10:00:00.000Z',
      lines: [
        {
          accountKey: `NGN:USER_ESCROW_LIABILITY:${TRADE}`,
          accountType: 'USER_ESCROW_LIABILITY',
          direction: 'DEBIT',
          amountMinor: '4750000',
        },
        {
          accountKey: `NGN:USER_PAYABLE:${OWNER}`,
          accountType: 'USER_PAYABLE',
          direction: 'CREDIT',
          amountMinor: '4750000',
        },
      ],
    });
    expect(parsed.lines[0]?.amountMinor).toBe('4750000');
    expect(koboSchema.parse(parsed.lines[0]?.amountMinor)).toBe(4_750_000n);
  });
});
