// Where a seller's money may go (T-073, M8 §5.5): adding a bank account, verifying it with the
// provider, choosing the default, and removing one.
//
// The account number is held three ways and never a fourth: encrypted (the recipient call needs it),
// masked to the last four (the only form a client sees), and HMAC-hashed under the platform pepper
// (the de-duplication key). It is never logged and never returned. The name on the account is always
// the one the provider resolved, never one a user typed (m8 §7).
//
// Adding an account answers at once with a PENDING_VERIFICATION row; a job resolves the name, reads
// T-051's name-match verdict, creates the transfer recipient and marks it VERIFIED or FAILED. The
// request never waits on the provider (design §4.4).
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { ApiError } from '../../../platform/errors.js';
import type { Logger } from '../../../platform/logger.js';
import {
  AccountNotResolvableError,
  maskAccountNumber,
  normaliseNuban,
  PAYOUT_ACCOUNT_HASH_DOMAIN,
} from '../domain/payouts.js';
import type { PaymentProviderAdapter } from '../domain/providerAdapter.js';
import type { BankListCache } from '../infrastructure/bankListCache.js';
import { providerForNewCharge } from '../infrastructure/providerRegistry.js';
import {
  countInFlightToAccount,
  findDefaultAccount,
  findLiveAccount,
  findPayoutAccount,
  findPayoutMode,
  insertPayoutAccount,
  listPayoutAccounts,
  lockPayoutAccount,
  lockUserPayouts,
  updatePayoutAccount,
} from '../infrastructure/postgres/payoutsRepository.js';
import type { PayoutAccountRow } from '../infrastructure/postgres/schema/payouts.js';

/** The two secrets an account number is kept under. Absent in a process that cannot hold one. */
export interface PayoutAccountCrypto {
  encryption: Encryption;
  hasher: HmacHasher;
}

export interface PayoutAccountDeps {
  db: Db;
  crypto: PayoutAccountCrypto | undefined;
  banks: BankListCache;
  /** Queues the verify job for one account. */
  enqueueVerify: (payoutAccountId: string) => Promise<void>;
  logger: Logger;
}

export interface PayoutAccountView {
  id: string;
  bankCode: string;
  bankName: string | null;
  accountNumberMasked: string;
  accountName: string | null;
  status: PayoutAccountRow['status'];
  isDefault: boolean;
  failureReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export const payoutAccountView = (row: PayoutAccountRow): PayoutAccountView => ({
  id: row.id,
  bankCode: row.bankCode,
  bankName: row.bankName,
  accountNumberMasked: row.accountNumberMasked,
  accountName: row.accountName,
  status: row.status,
  isDefault: row.isDefault,
  failureReason: row.failureReason,
  createdAt: row.createdAt.toISOString(),
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
});

const notFound = () => new ApiError(404, 'NOT_FOUND', 'No such payout account');

const cryptoOf = (deps: Pick<PayoutAccountDeps, 'crypto'>): PayoutAccountCrypto => {
  if (!deps.crypto) {
    throw new ApiError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Bank accounts cannot be added right now',
      'ENCRYPTION_KEY or IDENTITY_HMAC_PEPPER is not set',
    );
  }
  return deps.crypto;
};

/** The caller's own account, or a 404 — never a 403, which would confirm the id exists. */
const owned = (row: PayoutAccountRow | undefined, userId: string): PayoutAccountRow => {
  if (!row || row.userId !== userId || row.status === 'DISABLED') throw notFound();
  return row;
};

/**
 * `POST /me/payout-accounts`. Adding the same live account again returns the row already on file, so
 * a retry is one account and one verify job.
 */
export async function addPayoutAccount(
  deps: PayoutAccountDeps,
  input: { userId: string; bankCode: string; accountNumber: string },
): Promise<PayoutAccountView> {
  const userId = input.userId.toLowerCase();
  const accountNumber = normaliseNuban(input.accountNumber);
  if (!accountNumber) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Enter the ten-digit account number');
  }
  const banks = await deps.banks.read();
  if (!banks) {
    // Fail closed: a bank code nobody can check is a transfer that fails a day later.
    throw new ApiError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'The bank list is not available yet',
      'the bank list cache is empty',
    );
  }
  const bank = banks.find((b) => b.code === input.bankCode);
  if (!bank) throw new ApiError(422, 'VALIDATION_FAILED', 'Choose a bank from the list');

  const { encryption, hasher } = cryptoOf(deps);
  const accountNumberHash = hasher.hmac(PAYOUT_ACCOUNT_HASH_DOMAIN, accountNumber);

  const existing = await findLiveAccount(deps.db, { userId, bankCode: bank.code, accountNumberHash });
  let row: PayoutAccountRow;
  if (existing) {
    row = existing;
  } else {
    try {
      row = await insertPayoutAccount(deps.db, {
        userId,
        provider: providerForNewCharge(),
        bankCode: bank.code,
        bankName: bank.name,
        accountNumberEnc: encryption.encrypt(accountNumber),
        accountNumberMasked: maskAccountNumber(accountNumber),
        accountNumberHash,
      });
    } catch (error) {
      // Two taps racing: the loser's insert hits the one-live index, and the winner's row answers both.
      if (!isUniqueViolation(error, 'payout_accounts_one_live')) throw error;
      const winner = await findLiveAccount(deps.db, { userId, bankCode: bank.code, accountNumberHash });
      if (!winner) throw error;
      row = winner;
    }
  }

  if (row.status === 'PENDING_VERIFICATION') {
    try {
      await deps.enqueueVerify(row.id);
    } catch (error) {
      // The row is stored; the account sweep re-queues it. The seller still sees it pending.
      deps.logger.error(
        { err: error, payoutAccountId: row.id },
        'ledger: payout account verify enqueue failed',
      );
    }
  }
  return payoutAccountView(row);
}

export async function listAccounts(
  deps: Pick<PayoutAccountDeps, 'db'>,
  userId: string,
): Promise<{ accounts: PayoutAccountView[] }> {
  const rows = await listPayoutAccounts(deps.db, userId.toLowerCase());
  return { accounts: rows.map(payoutAccountView) };
}

/** `POST /me/payout-accounts/:id/default`: only a verified account can be where automatic payouts go. */
export async function setDefaultPayoutAccount(
  deps: Pick<PayoutAccountDeps, 'db'>,
  input: { userId: string; payoutAccountId: string },
): Promise<PayoutAccountView> {
  const userId = input.userId.toLowerCase();
  return deps.db.transaction(async (tx) => {
    await lockUserPayouts(tx, userId);
    const account = owned(await lockPayoutAccount(tx, input.payoutAccountId), userId);
    if (account.status !== 'VERIFIED') {
      throw new ApiError(
        409,
        'PAYOUT_ACCOUNT_REQUIRED',
        'Only a verified account can be your payout account',
        `the account is ${account.status}`,
      );
    }
    if (account.isDefault) return payoutAccountView(account);
    const current = await findDefaultAccount(tx, userId);
    // Cleared first: the one-default index is checked per statement, not at commit.
    if (current) await updatePayoutAccount(tx, current.id, { isDefault: false });
    return payoutAccountView(await updatePayoutAccount(tx, account.id, { isDefault: true }));
  });
}

/**
 * `DELETE /me/payout-accounts/:id`. Disables rather than deletes: an account is where a payout went,
 * and the receipt still names it. Refused while an automatic mode depends on it, or while a payout to
 * it is still on its way.
 */
export async function removePayoutAccount(
  deps: Pick<PayoutAccountDeps, 'db'>,
  input: { userId: string; payoutAccountId: string; now?: Date },
): Promise<PayoutAccountView> {
  const userId = input.userId.toLowerCase();
  return deps.db.transaction(async (tx) => {
    await lockUserPayouts(tx, userId);
    const account = owned(await lockPayoutAccount(tx, input.payoutAccountId), userId);
    if (account.isDefault && (await findPayoutMode(tx, userId)) !== 'MANUAL') {
      throw new ApiError(
        409,
        'PAYOUT_ACCOUNT_REQUIRED',
        'Your automatic payouts go to this account',
        'switch payouts to manual, or choose another default account, before removing it',
      );
    }
    if ((await countInFlightToAccount(tx, account.id)) > 0) {
      throw new ApiError(
        409,
        'CONFLICT',
        'A payout to this account is still on its way',
        'remove the account once it has arrived',
      );
    }
    return payoutAccountView(
      await updatePayoutAccount(tx, account.id, {
        status: 'DISABLED',
        isDefault: false,
        disabledAt: input.now ?? new Date(),
      }),
    );
  });
}

// ---------------------------------------------------------------------------------------------
// The verify job's work
// ---------------------------------------------------------------------------------------------

/** T-051's verdict on a bank account, narrowed to what accepting a payout account reads. */
export interface NameMatchVerdict {
  id: string;
  matchResult: 'EXACT' | 'FUZZY_MATCH' | 'MISMATCH';
}

export interface VerifyPayoutAccountDeps {
  db: Db;
  crypto: PayoutAccountCrypto;
  adapter: Pick<PaymentProviderAdapter, 'resolveAccountName' | 'createTransferRecipient'>;
  readNameMatch: (input: {
    userId: string;
    bankCode: string;
    accountNumber: string;
  }) => Promise<NameMatchVerdict | undefined>;
  logger: Logger;
  now?: () => Date;
}

export const ACCOUNT_NOT_FOUND_REASON = 'The bank could not find this account. Check the number and bank.';
export const NAME_MISMATCH_REASON = 'The name on this account does not match your verified business name.';

/**
 * Resolves, checks and registers one pending account. Every provider call happens before the write,
 * and the write re-checks the row under its lock, so a retry after a crash finishes the job rather
 * than repeating it. An unresolvable account is FAILED; an outage throws and the queue retries.
 */
export async function verifyPayoutAccount(
  deps: VerifyPayoutAccountDeps,
  payoutAccountId: string,
): Promise<PayoutAccountRow['status'] | 'MISSING'> {
  const account = await findPayoutAccount(deps.db, payoutAccountId);
  if (!account) return 'MISSING';
  if (account.status !== 'PENDING_VERIFICATION') return account.status;

  const accountNumber = deps.crypto.encryption.decrypt(account.accountNumberEnc);

  let accountName: string;
  try {
    accountName = (await deps.adapter.resolveAccountName(accountNumber, account.bankCode)).accountName;
  } catch (error) {
    if (!(error instanceof AccountNotResolvableError)) throw error;
    return fail(deps, account.id, ACCOUNT_NOT_FOUND_REASON);
  }

  // Owner decision 3 (the plan): a MISMATCH on record refuses the account; an EXACT or FUZZY_MATCH is
  // linked; no record (every casual seller) is accepted on the provider's resolution alone.
  const match = await deps.readNameMatch({
    userId: account.userId,
    bankCode: account.bankCode,
    accountNumber,
  });
  if (match?.matchResult === 'MISMATCH') return fail(deps, account.id, NAME_MISMATCH_REASON, match);

  const { providerRecipientId } = await deps.adapter.createTransferRecipient({
    accountNumber,
    bankCode: account.bankCode,
    accountName,
  });

  const now = deps.now?.() ?? new Date();
  return deps.db.transaction(async (tx) => {
    await lockUserPayouts(tx, account.userId);
    const locked = await lockPayoutAccount(tx, account.id);
    if (!locked || locked.status !== 'PENDING_VERIFICATION') return locked?.status ?? 'MISSING';
    const hasDefault = (await findDefaultAccount(tx, account.userId)) !== undefined;
    const row = await updatePayoutAccount(tx, account.id, {
      status: 'VERIFIED',
      accountName,
      providerRecipientId,
      verifiedAt: now,
      // The first verified account becomes the default; a later one waits to be chosen.
      isDefault: !hasDefault,
      ...(match ? { nameMatchRef: match.id, nameMatchResult: match.matchResult } : {}),
    });
    deps.logger.info(
      { payoutAccountId: row.id, isDefault: row.isDefault },
      'ledger: payout account verified',
    );
    return row.status;
  });
}

async function fail(
  deps: Pick<VerifyPayoutAccountDeps, 'db' | 'logger'>,
  id: string,
  reason: string,
  match?: NameMatchVerdict,
): Promise<PayoutAccountRow['status'] | 'MISSING'> {
  return deps.db.transaction(async (tx) => {
    const locked = await lockPayoutAccount(tx, id);
    if (!locked || locked.status !== 'PENDING_VERIFICATION') return locked?.status ?? 'MISSING';
    await updatePayoutAccount(tx, id, {
      status: 'FAILED',
      failureReason: reason,
      ...(match ? { nameMatchRef: match.id, nameMatchResult: match.matchResult } : {}),
    });
    deps.logger.warn({ payoutAccountId: id }, 'ledger: payout account failed verification');
    return 'FAILED' as const;
  });
}
