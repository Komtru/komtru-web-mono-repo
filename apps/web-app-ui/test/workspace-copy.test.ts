import { describe, expect, it } from 'vitest';
import { WORKSPACE_STATUSES, type TradeRole } from '../src/trade/workspace-state';
import { extensionPending, notYet, releasePaused, stateCopy } from '../src/trade/workspace-copy';

const ROLES: TradeRole[] = ['BUYER', 'SELLER'];
const ctx = {
  grace: '24 hours',
  itemAmount: '₦452,000',
  proceeds: '₦440,000',
  counterparty: 'Amaka B.',
  version: 2,
};

describe('what the workspace says, for each side', () => {
  it.each(WORKSPACE_STATUSES)('says something for %s, to both sides', (status) => {
    for (const role of ROLES) {
      const copy = stateCopy(status, role, ctx);
      expect(copy.banner !== undefined || copy.hero !== undefined, `${status} ${role}`).toBe(true);
    }
  });

  it.each(['FUNDED', 'SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION', 'DISPUTED'] as const)(
    'words %s differently for the buyer and the seller, because they are doing different things',
    (status) => {
      const buyer = JSON.stringify(stateCopy(status, 'BUYER', ctx).banner);
      const seller = JSON.stringify(stateCopy(status, 'SELLER', ctx).banner);
      expect(buyer).not.toBe(seller);
    },
  );

  it('keeps the seams to the side that would act: shipping is built, so neither side is told it is missing', () => {
    expect(stateCopy('FUNDED', 'SELLER').seam).toBeUndefined();
    expect(stateCopy('FUNDED', 'BUYER').seam).toBeUndefined();
    // Confirming delivery and accepting are built (F-027), and so now is reporting an issue and
    // the case behind it (F-032) — neither side is told anything is missing on these states.
    expect(stateCopy('UNCONFIRMED_DELIVERY', 'BUYER', ctx).seam).toBeUndefined();
    expect(stateCopy('INSPECTION', 'BUYER', ctx).seam).toBeUndefined();
    expect(stateCopy('INSPECTION', 'SELLER', ctx).seam).toBeUndefined();
    expect(stateCopy('DISPUTED', 'BUYER', ctx).seam).toBeUndefined();
    expect(stateCopy('DISPUTED', 'SELLER', ctx).seam).toBeUndefined();
  });

  it('F-032: still tells both sides the money is held while a case is open', () => {
    for (const role of ROLES) {
      const copy = stateCopy('DISPUTED', role, ctx);
      expect(copy.banner?.title).toContain('funds remain protected');
      expect(copy.payoutHeld).toBe('held while the case is open');
    }
  });

  it('never promises a control: no copy tells a person to press, tap or click anything', () => {
    for (const status of WORKSPACE_STATUSES) {
      for (const role of ROLES) {
        expect(JSON.stringify(stateCopy(status, role, ctx)), `${status} ${role}`).not.toMatch(
          /\b(press|tap|click)\b/i,
        );
      }
    }
  });

  it('says how much was released, to whom, from the reader’s side', () => {
    expect(stateCopy('SETTLED', 'BUYER', ctx).hero?.body).toContain('₦452,000 released to Amaka B.');
    expect(stateCopy('SETTLED', 'SELLER', ctx).hero?.body).toContain('₦440,000 released to you.');
    expect(stateCopy('SETTLED', 'BUYER').hero?.body).toBe('Both sides honoured the agreement in full.');
  });

  it('puts the grace period into the words when the trade has one, and omits it when not', () => {
    expect(stateCopy('UNCONFIRMED_DELIVERY', 'BUYER', ctx).banner?.body).toContain('within 24 hours');
    expect(stateCopy('UNCONFIRMED_DELIVERY', 'BUYER').banner?.body).not.toContain('within');
  });

  it('says no more about a hold than the platform does: the clock is stopped', () => {
    expect(JSON.stringify(releasePaused)).not.toMatch(/Komtru is|looking|review|risk|investigat/i);
    expect(releasePaused.body).toContain('clock is stopped');
  });

  it('words a request for more time for each side', () => {
    expect(extensionPending('BUYER').body).toContain('You asked');
    expect(extensionPending('SELLER').body).toContain('Your answer is needed');
  });

  it('says a refund or decision is recorded, never that money has arrived', () => {
    for (const status of ['RESOLVED_RELEASED', 'RESOLVED_REFUNDED'] as const) {
      expect(stateCopy(status, 'BUYER').banner?.body).toContain(
        'not a confirmation that the money has arrived',
      );
    }
  });

  it('does not promise a refund for a trade cancelled after payment: the refund row says that', () => {
    const copy = stateCopy('CANCELLED_REFUNDED', 'BUYER');
    expect(copy.hero?.body).toBe('The trade was cancelled after payment.');
    expect(JSON.stringify(copy)).not.toMatch(/refunded|You are refunded|arrived/);
  });
});
