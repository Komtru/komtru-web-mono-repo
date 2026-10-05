// M8 §5.1. `ledger_account_type` follows M8 §4's chart, plus BUYER_PROTECTION_FEE_REVENUE (T-070):
// the buyer protection fee is Komtru's revenue but is not the same line of business as the platform
// commission, and reporting needs them apart. No Park account exists — the Park handling fee is cash
// between the buyer and the agent and Komtru records nothing about it (design C23).
import { ledger } from './columns.js';

export const ledgerAccountType = ledger.enum('ledger_account_type', [
  'PLATFORM_ESCROW_POOL', // asset: cash sitting in a provider balance
  'USER_ESCROW_LIABILITY', // liability, one per trade: what we owe into escrow
  'USER_PAYABLE', // liability, one per user: released funds not yet paid out
  'PLATFORM_FEE_REVENUE', // revenue: the platform commission
  'BUYER_PROTECTION_FEE_REVENUE', // revenue: the buyer protection fee (design §6.5)
  'SETTLEMENT_CLEARING', // asset, one per in-flight payout: left payable, not yet landed
]);

export const ledgerEntryDirection = ledger.enum('ledger_entry_direction', ['DEBIT', 'CREDIT']);

/**
 * Declared here because this is the first migration in the `ledger` schema and every money-moving
 * row is provider-tagged from day one, so a second provider is additive (m8 plan §1, §4). T-071's
 * adapter and T-072's payment_attempts import this rather than declaring a second enum.
 */
export const paymentProvider = ledger.enum('payment_provider', ['PAYSTACK', 'FLUTTERWAVE']);
