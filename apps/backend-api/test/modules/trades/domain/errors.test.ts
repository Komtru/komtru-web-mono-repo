// The status codes design §6.2 and §6.3 name, so a client can branch on them.
import { describe, expect, it } from 'vitest';
import {
  buyerNotVerifiedError,
  invalidTransitionError,
  merchantCannotBuyError,
  sellerNotVerifiedError,
} from '../../../../src/modules/trades/domain/errors.js';

describe('trade errors', () => {
  it('reports an invalid jump as 409 INVALID_TRANSITION, naming both statuses', () => {
    const error = invalidTransitionError('FUND', 'DRAFT', 'FUNDED');
    expect(error.status).toBe(409);
    expect(error.code).toBe('INVALID_TRANSITION');
    expect(error.detail).toContain('DRAFT');
    expect(error.detail).toContain('FUNDED');
  });

  it('reports a merchant taking a buyer role as 403 MERCHANT_CANNOT_BUY', () => {
    const error = merchantCannotBuyError('CART_CHECKOUT');
    expect(error.status).toBe(403);
    expect(error.code).toBe('MERCHANT_CANNOT_BUY');
  });

  it('separates the two funding gates', () => {
    expect(buyerNotVerifiedError().code).toBe('BUYER_NOT_VERIFIED');
    expect(sellerNotVerifiedError().code).toBe('SELLER_NOT_VERIFIED');
  });
});
