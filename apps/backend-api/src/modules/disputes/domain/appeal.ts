// M3 D5, as a pure rule: one appeal, by a party, from a decided case, inside the window.
import { isPast } from './windows.js';
import type { DisputeStatus } from './types.js';

export type AppealRefusal = 'NOT_A_PARTY' | 'NOT_DECIDED' | 'ALREADY_APPEALED' | 'WINDOW_CLOSED';

export type AppealEligibility = { allowed: true } | { allowed: false; reason: AppealRefusal };

export interface AppealInput {
  status: DisputeStatus;
  appealDeadlineAt: Date | null;
  appealFiledAt: Date | null;
  userId: string;
  buyerUserId: string;
  sellerUserId: string;
  now: Date;
}

/**
 * The order of the checks is part of the rule, not an implementation detail. Party membership is
 * decided first so that a stranger probing a dispute id gets the same refusal whatever the case's
 * state or timing — "not yours" never leaks whether a decision exists or when its window shuts.
 */
export function appealEligibility(input: AppealInput): AppealEligibility {
  const isParty = input.userId === input.buyerUserId || input.userId === input.sellerUserId;
  if (!isParty) return { allowed: false, reason: 'NOT_A_PARTY' };

  if (input.status !== 'DECIDED') return { allowed: false, reason: 'NOT_DECIDED' };

  // Checked before the window: a party who has already appealed should be told that, not told the
  // clock ran out, because the two have different answers ("you've had your appeal" vs "too late").
  if (input.appealFiledAt !== null) return { allowed: false, reason: 'ALREADY_APPEALED' };

  // No deadline recorded means no window was ever opened, which is the same thing as a shut one.
  if (input.appealDeadlineAt === null) return { allowed: false, reason: 'WINDOW_CLOSED' };
  if (isPast(input.appealDeadlineAt, input.now)) return { allowed: false, reason: 'WINDOW_CLOSED' };

  return { allowed: true };
}
