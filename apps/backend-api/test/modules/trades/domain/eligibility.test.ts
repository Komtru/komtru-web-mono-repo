// Design §6.3, the owner's 2026-10-05 ruling: every account may buy or sell, a certified merchant
// may only sell, and the money-safety gates stay. There is no SELLER capability gate any more.
import { describe, expect, it } from 'vitest';
import {
  BUYER_PATHS,
  assertCanActAsBuyer,
  assertFundingEligibility,
  canActAsBuyer,
  initiatorRoleFor,
  type TradePrincipal,
} from '../../../../src/modules/trades/domain/eligibility.js';
import type { ApiError } from '../../../../src/platform/errors.js';

const principal = (over: Partial<TradePrincipal> = {}): TradePrincipal => ({
  userId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a10',
  merchantCapabilityStatus: null,
  verificationLevel: 'IDENTITY_VERIFIED',
  ...over,
});

const merchant = principal({ merchantCapabilityStatus: 'ACTIVE' });

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as ApiError).code;
  }
  return 'no error';
};

describe('canActAsBuyer', () => {
  it.each(BUYER_PATHS)('blocks a certified merchant on the %s path', (path) => {
    expect(canActAsBuyer(merchant)).toBe(false);
    expect(codeOf(() => assertCanActAsBuyer(merchant, path))).toBe('MERCHANT_CANNOT_BUY');
  });

  it('lets an ordinary account buy', () => {
    expect(canActAsBuyer(principal())).toBe(true);
    expect(codeOf(() => assertCanActAsBuyer(principal(), 'CART_CHECKOUT'))).toBe('no error');
  });

  it('lets an account whose certification is suspended or revoked buy again', () => {
    expect(canActAsBuyer(principal({ merchantCapabilityStatus: 'SUSPENDED' }))).toBe(true);
    expect(canActAsBuyer(principal({ merchantCapabilityStatus: 'REVOKED' }))).toBe(true);
  });

  it('does not block while an application is still PENDING', () => {
    expect(canActAsBuyer(principal({ merchantCapabilityStatus: 'PENDING' }))).toBe(true);
  });
});

describe('initiatorRoleFor', () => {
  it('keeps the side an ordinary account chose', () => {
    expect(initiatorRoleFor(principal(), 'BUYER')).toBe('BUYER');
    expect(initiatorRoleFor(principal(), 'SELLER')).toBe('SELLER');
  });

  it('forces a certified merchant to SELLER', () => {
    expect(initiatorRoleFor(merchant, 'SELLER')).toBe('SELLER');
  });

  it('rejects a certified merchant asking for BUYER', () => {
    expect(codeOf(() => initiatorRoleFor(merchant, 'BUYER'))).toBe('MERCHANT_CANNOT_BUY');
  });
});

describe('assertFundingEligibility', () => {
  const verifiedSeller = principal({ userId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a11' });

  it('passes a contact-verified buyer and an identity-verified seller', () => {
    expect(
      codeOf(() =>
        assertFundingEligibility(principal({ verificationLevel: 'CONTACT_VERIFIED' }), verifiedSeller),
      ),
    ).toBe('no error');
  });

  it('blocks an unverified buyer with BUYER_NOT_VERIFIED (M1 level 1)', () => {
    expect(
      codeOf(() => assertFundingEligibility(principal({ verificationLevel: 'UNVERIFIED' }), verifiedSeller)),
    ).toBe('BUYER_NOT_VERIFIED');
  });

  it('blocks a merely contact-verified seller with SELLER_NOT_VERIFIED (M6 level 2)', () => {
    const seller = principal({
      userId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a11',
      verificationLevel: 'CONTACT_VERIFIED',
    });
    expect(codeOf(() => assertFundingEligibility(principal(), seller))).toBe('SELLER_NOT_VERIFIED');
  });

  it('asks no capability of the seller: C19 removed the SELLER gate', () => {
    const casual = principal({
      userId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a11',
      merchantCapabilityStatus: null,
    });
    expect(codeOf(() => assertFundingEligibility(principal(), casual))).toBe('no error');
  });
});
