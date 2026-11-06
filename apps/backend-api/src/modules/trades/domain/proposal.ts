// The pure half of the proposal flow (T-061): who is on which side, whose turn it is, and whether the
// seller's proof meets the category's standard. No database, no clock.
import type { TradeInitiatorRole } from './eligibility.js';

export const otherRole = (role: TradeInitiatorRole): TradeInitiatorRole =>
  role === 'BUYER' ? 'SELLER' : 'BUYER';

interface Parties {
  buyerUserId: string | null;
  sellerUserId: string | null;
}

/** Which side a user holds on the trade, or null for a stranger (who is told it does not exist). */
export const sideOf = (trade: Parties, userId: string): TradeInitiatorRole | null =>
  trade.buyerUserId === userId ? 'BUYER' : trade.sellerUserId === userId ? 'SELLER' : null;

export const userForRole = (trade: Parties, role: TradeInitiatorRole): string | null =>
  role === 'BUYER' ? trade.buyerUserId : trade.sellerUserId;

export interface ProofRequirement {
  minPhotos: number;
  requireVideo: boolean;
}

export type ProofCheck = { ok: true } | { ok: false; missingPhotos: number; missingVideo: boolean };

/**
 * W1: seller proof is mandatory even for a category that asks for no photos, because "mandatory
 * before PENDING_PAYMENT" is a rule about the trade, not about the category. A category's
 * `minPhotos` raises the bar; it cannot lower it below one piece of media.
 */
export function checkProofMedia(
  requirement: ProofRequirement,
  files: readonly { contentType: string }[],
): ProofCheck {
  const photos = files.filter((file) => file.contentType.startsWith('image/')).length;
  const videos = files.filter((file) => file.contentType.startsWith('video/')).length;
  const neededPhotos = Math.max(requirement.minPhotos, requirement.requireVideo ? 0 : 1);
  const missingPhotos = Math.max(0, neededPhotos - photos);
  const missingVideo = requirement.requireVideo && videos === 0;
  return missingPhotos === 0 && !missingVideo ? { ok: true } : { ok: false, missingPhotos, missingVideo };
}
