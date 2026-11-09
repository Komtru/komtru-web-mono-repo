// M8 §5.1. `ledger_account_type` follows M8 §4's chart, plus BUYER_PROTECTION_FEE_REVENUE (T-070):
// the buyer protection fee is Komtru's revenue but is not the same line of business as the platform
// commission, and reporting needs them apart. T-072 adds BUYER_PROTECTION_FEE_LIABILITY, the account
// that fee sits in between funding and release. No Park account exists — the Park handling fee is
// cash between the buyer and the agent and Komtru records nothing about it (design C23).
//
// Adding a value here is not free: `account_key` is GENERATED ALWAYS from a CASE over this enum, so
// a new value means dropping and re-adding that column — see migration 0043 and T-070's status note.
import { ledger } from './columns.js';

export const ledgerAccountType = ledger.enum('ledger_account_type', [
  'PLATFORM_ESCROW_POOL', // asset: cash sitting in a provider balance
  'USER_ESCROW_LIABILITY', // liability, one per trade: what we owe into escrow
  // Liability, one per trade: the buyer protection fee, charged at funding and unearned until
  // release. Kept off USER_ESCROW_LIABILITY so that account's balance is exactly the item money the
  // buyer could get back; T-074 debits this one to BUYER_PROTECTION_FEE_REVENUE at release, and
  // T-075's refund policy decides whether a refund discharges it to the buyer instead.
  'BUYER_PROTECTION_FEE_LIABILITY',
  'USER_PAYABLE', // liability, one per user: released funds not yet paid out
  'PLATFORM_FEE_REVENUE', // revenue: the platform commission
  'BUYER_PROTECTION_FEE_REVENUE', // revenue: the buyer protection fee (design §6.5)
  // One per in-flight payout: left USER_PAYABLE but not yet taken by the bank. Credit-normal, not
  // the asset M8 §5's table calls it — see normalBalance() in domain/accounts.ts for why §4's own
  // postings settle the question. T-073/T-074 must post it as an obligation, not as cash.
  'SETTLEMENT_CLEARING',
]);

export const ledgerEntryDirection = ledger.enum('ledger_entry_direction', ['DEBIT', 'CREDIT']);

/**
 * Declared here because this is the first migration in the `ledger` schema and every money-moving
 * row is provider-tagged from day one, so a second provider is additive (m8 plan §1, §4). T-071's
 * adapter and T-072's payment_attempts import this rather than declaring a second enum.
 */
export const paymentProvider = ledger.enum('payment_provider', ['PAYSTACK', 'FLUTTERWAVE']);
