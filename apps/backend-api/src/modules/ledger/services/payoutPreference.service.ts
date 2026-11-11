// How a seller wants to be paid (T-073): MANUAL, or one of the automatic modes. The preference holds
// the mode only; an automatic payout always goes to the default account, so there is one "where",
// not two that can disagree.
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import {
  findDefaultAccount,
  findPayoutMode,
  lockUserPayouts,
  upsertPayoutMode,
} from '../infrastructure/postgres/payoutsRepository.js';
import type { PayoutMode } from '../infrastructure/postgres/schema/payouts.js';
import { destinationView, type PayoutDestinationView } from './payout.service.js';

export interface PayoutPreferenceView {
  mode: PayoutMode;
  defaultAccount: PayoutDestinationView | null;
}

export async function getPayoutPreference(db: Db, userId: string): Promise<PayoutPreferenceView> {
  const user = userId.toLowerCase();
  const [mode, account] = await Promise.all([findPayoutMode(db, user), findDefaultAccount(db, user)]);
  return { mode, defaultAccount: account ? destinationView(account) : null };
}

/**
 * `PUT /me/payout-preferences`. Any mode other than MANUAL is refused without a verified default
 * account — checked under the same lock that removing an account takes, so the two cannot cross.
 */
export async function setPayoutPreference(
  db: Db,
  input: { userId: string; mode: PayoutMode },
): Promise<PayoutPreferenceView> {
  const userId = input.userId.toLowerCase();
  return db.transaction(async (tx) => {
    await lockUserPayouts(tx, userId);
    const account = await findDefaultAccount(tx, userId);
    if (input.mode !== 'MANUAL' && account?.status !== 'VERIFIED') {
      throw new ApiError(
        409,
        'PAYOUT_ACCOUNT_REQUIRED',
        'Add a verified bank account to turn on automatic payouts',
        'automatic payouts go to your default account',
      );
    }
    await upsertPayoutMode(tx, userId, input.mode);
    return { mode: input.mode, defaultAccount: account ? destinationView(account) : null };
  });
}
