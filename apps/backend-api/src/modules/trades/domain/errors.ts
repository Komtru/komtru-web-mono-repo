// The failures design §6.2 and §6.3 name explicitly. Each carries its own code: a client that gets
// "403 forbidden" cannot tell a merchant who may not buy from a seller who is not yet verified, and
// the two need different screens.
import { ApiError } from '../../../platform/errors.js';
import type { TradeAction, TradeStatus } from './stateMachine.js';
import type { BuyerPath } from './eligibility.js';

/** Design §6.2: an invalid jump is a 409, never a silent no-op. */
export const invalidTransitionError = (action: TradeAction, from: TradeStatus, to: TradeStatus): ApiError =>
  new ApiError(
    409,
    'INVALID_TRANSITION',
    'That step is not available on this trade',
    `${action} cannot move a trade from ${from} to ${to}.`,
  );

/** Design §6.3: a certified merchant is sell-only while the capability is ACTIVE. */
export const merchantCannotBuyError = (path: BuyerPath): ApiError =>
  new ApiError(
    403,
    'MERCHANT_CANNOT_BUY',
    'A certified merchant cannot buy',
    `This account sells as a certified merchant, so it cannot take the buyer side (${path}).`,
  );

/** M1 level 1: funding is a contact-verified action. */
export const buyerNotVerifiedError = (): ApiError =>
  new ApiError(
    403,
    'BUYER_NOT_VERIFIED',
    'Verify your contact details to fund a trade',
    'Funding needs a verified email address or phone number.',
  );

/** M6 level 2: payouts only go to identity-verified people (design §6.3, Q12). */
export const sellerNotVerifiedError = (): ApiError =>
  new ApiError(
    403,
    'SELLER_NOT_VERIFIED',
    'The seller is not identity-verified yet',
    'A trade cannot be funded until the seller has completed identity verification.',
  );

/** T-061: a trade needs a saved address from each side; the client sends the user to add one. */
export const addressRequiredError = (side: 'BUYER' | 'SELLER'): ApiError =>
  new ApiError(
    422,
    'ADDRESS_REQUIRED',
    'Add a saved address first',
    side === 'BUYER'
      ? 'A trade needs a saved delivery address from the buyer.'
      : 'A trade needs a saved ships-from address from the seller.',
  );

/** W1: Accept stays disabled until media is attached; the server says what is still missing. */
export const proofMediaRequiredError = (missing: {
  missingPhotos: number;
  missingVideo: boolean;
}): ApiError => {
  const parts = [
    ...(missing.missingPhotos > 0
      ? [`${missing.missingPhotos} more photo${missing.missingPhotos === 1 ? '' : 's'}`]
      : []),
    ...(missing.missingVideo ? ['a video'] : []),
  ];
  return new ApiError(
    422,
    'VALIDATION_FAILED',
    'The seller must attach proof of the item first',
    `Attach ${parts.join(' and ')} before this trade can move to payment.`,
    [{ path: 'proofFileIds', message: 'Seller proof media is required' }],
  );
};

export const itemSpecInvalidError = (missing: string[]): ApiError =>
  new ApiError(
    422,
    'VALIDATION_FAILED',
    'The item details are incomplete',
    `This category requires: ${missing.join(', ')}.`,
    missing.map((key) => ({ path: `itemSpec.${key}`, message: 'This detail is required' })),
  );

export const tradeNotFoundError = (): ApiError => new ApiError(404, 'NOT_FOUND', 'Trade not found');

export const notYourTurnError = (): ApiError =>
  new ApiError(
    409,
    'CONFLICT',
    'It is not your turn on this trade',
    'The latest terms are waiting on the other party; you cannot answer your own proposal.',
  );

export const selfTradeError = (): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'You cannot trade with yourself');
