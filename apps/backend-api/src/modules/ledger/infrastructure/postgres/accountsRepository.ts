// Turning an AccountRef into a row id. Never a check-then-insert: two callers funding the same
// trade at the same instant both run this, and the one that loses the race must read the winner's
// row rather than create a second account for the same money.
import { eq } from 'drizzle-orm';
import type { Db } from '../../../../db/index.js';
import type { Tx } from '../../../../platform/events/publish.js';
import {
  accountKey,
  currencySchema,
  DEFAULT_CURRENCY,
  normaliseAccountRef,
  type AccountRef,
} from '../../domain/accounts.js';
import { ledgerAccounts } from './schema/accounts.js';

/** A read can run on the pool or inside a caller's transaction; a write only inside one. */
export type Reader = Db | Tx;

/** The scope columns an account of this type carries; the CHECK refuses any other combination. */
const scopeColumns = (ref: AccountRef) => {
  switch (ref.type) {
    case 'USER_ESCROW_LIABILITY':
    case 'BUYER_PROTECTION_FEE_LIABILITY':
      return { tradeId: ref.tradeId };
    case 'USER_PAYABLE':
      return { ownerUserId: ref.ownerUserId };
    case 'SETTLEMENT_CLEARING':
      return { payoutId: ref.payoutId };
    default:
      return {};
  }
};

/**
 * The account's id, creating it if this is the first posting that needs it. `account_key` is a
 * generated column, so the conflict target is the identity itself rather than a column set the
 * caller chose, and a losing insert reads back the winner's committed row.
 */
export async function resolveAccountId(
  tx: Tx,
  ref: AccountRef,
  currency: string = DEFAULT_CURRENCY,
): Promise<string> {
  // Normalise once, then build the key and the row from the same normalised ref, so the column the
  // database generates and the key we look up by can never disagree.
  const normalised = normaliseAccountRef(ref);
  const checked = currencySchema.parse(currency);
  const key = accountKey(normalised, checked);
  const inserted = await tx
    .insert(ledgerAccounts)
    .values({ accountType: normalised.type, currency: checked, ...scopeColumns(normalised) })
    .onConflictDoNothing({ target: ledgerAccounts.accountKey })
    .returning({ id: ledgerAccounts.id });
  const created = inserted[0]?.id;
  if (created) return created;

  const [existing] = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.accountKey, key))
    .limit(1);
  if (!existing) throw new Error(`ledger: account ${key} neither inserted nor found`);
  return existing.id;
}

/** The id of an account that already exists, or null — for reads that must not create anything. */
export async function findAccountId(
  tx: Reader,
  ref: AccountRef,
  currency: string = DEFAULT_CURRENCY,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.accountKey, accountKey(ref, currency)))
    .limit(1);
  return row?.id ?? null;
}
