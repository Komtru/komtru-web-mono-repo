-- T-072: BUYER_PROTECTION_FEE_LIABILITY, the account the buyer protection fee sits in between
-- funding and release (owner decision 1). Hand-written: what `drizzle-kit generate` emits for this
-- change does not run, and would lose an index if it did. Both reasons are worth writing down.
--
-- 1. `ALTER TYPE ... ADD VALUE` is legal inside a transaction, but the value it adds cannot be USED
--    until that transaction commits ("unsafe use of new value", PG 16). The drizzle migrator runs
--    every pending migration in ONE transaction, and both the `account_key` expression and the
--    scope CHECK have to name the new label, so no split into two migration files helps either.
--    The enum is therefore rebuilt rather than extended: a new type with the full set of labels,
--    the column retyped through text, the old type dropped. Values of a type created in the same
--    transaction are usable at once, so this is the form that runs from empty AND on top of main.
-- 2. `account_key` is GENERATED ALWAYS from a CASE over the enum, and `ALTER COLUMN ... SET
--    EXPRESSION` is PG 18. Dropping and re-adding the column is the only way on 16 — exactly the
--    cost T-070's status note said adding an account type later would carry. Dropping the column
--    drops `ledger_accounts_key_unique` with it; drizzle's own output never puts it back, which
--    would leave account identity unenforced, so it is recreated explicitly below.
--
-- A table rewrite is acceptable here: `ledger_accounts` has one row per trade, user and payout and
-- there is no production data at all. Both DROPs are reversible by re-running 0018's definitions.
ALTER TABLE "ledger"."ledger_accounts" DROP CONSTRAINT "ledger_accounts_scope";--> statement-breakpoint
-- The CHECK first and the generated column second: both depend on account_type, and Postgres
-- refuses to retype a column that either one still references.
ALTER TABLE "ledger"."ledger_accounts" DROP COLUMN "account_key";--> statement-breakpoint
ALTER TYPE "ledger"."ledger_account_type" RENAME TO "ledger_account_type_pre_0044";--> statement-breakpoint
CREATE TYPE "ledger"."ledger_account_type" AS ENUM('PLATFORM_ESCROW_POOL', 'USER_ESCROW_LIABILITY', 'BUYER_PROTECTION_FEE_LIABILITY', 'USER_PAYABLE', 'PLATFORM_FEE_REVENUE', 'BUYER_PROTECTION_FEE_REVENUE', 'SETTLEMENT_CLEARING');--> statement-breakpoint
ALTER TABLE "ledger"."ledger_accounts" ALTER COLUMN "account_type" TYPE "ledger"."ledger_account_type" USING "account_type"::text::"ledger"."ledger_account_type";--> statement-breakpoint
DROP TYPE "ledger"."ledger_account_type_pre_0044";--> statement-breakpoint
ALTER TABLE "ledger"."ledger_accounts" ADD COLUMN "account_key" text GENERATED ALWAYS AS ("currency" || ':' || (CASE "account_type"
    WHEN 'PLATFORM_ESCROW_POOL' THEN 'PLATFORM_ESCROW_POOL'
    WHEN 'USER_ESCROW_LIABILITY' THEN 'USER_ESCROW_LIABILITY'
    WHEN 'BUYER_PROTECTION_FEE_LIABILITY' THEN 'BUYER_PROTECTION_FEE_LIABILITY'
    WHEN 'USER_PAYABLE' THEN 'USER_PAYABLE'
    WHEN 'PLATFORM_FEE_REVENUE' THEN 'PLATFORM_FEE_REVENUE'
    WHEN 'BUYER_PROTECTION_FEE_REVENUE' THEN 'BUYER_PROTECTION_FEE_REVENUE'
    WHEN 'SETTLEMENT_CLEARING' THEN 'SETTLEMENT_CLEARING'
  END) || ':' || COALESCE("owner_user_id"::text, "trade_id"::text, "payout_id"::text, '-')) STORED NOT NULL;--> statement-breakpoint
-- Account identity. Without this the ON CONFLICT (account_key) in resolveAccountId has no arbiter
-- and two codepaths funding the same trade would each create their own account for the same money.
CREATE UNIQUE INDEX "ledger_accounts_key_unique" ON "ledger"."ledger_accounts" USING btree ("account_key");--> statement-breakpoint
-- Unchanged except for the new branch: a fee liability carries a trade and nothing else, exactly
-- like the escrow liability it sits beside.
ALTER TABLE "ledger"."ledger_accounts" ADD CONSTRAINT "ledger_accounts_scope" CHECK (CASE "ledger"."ledger_accounts"."account_type"
            WHEN 'USER_ESCROW_LIABILITY' THEN "ledger"."ledger_accounts"."trade_id" IS NOT NULL AND "ledger"."ledger_accounts"."owner_user_id" IS NULL AND "ledger"."ledger_accounts"."payout_id" IS NULL
            WHEN 'BUYER_PROTECTION_FEE_LIABILITY' THEN "ledger"."ledger_accounts"."trade_id" IS NOT NULL AND "ledger"."ledger_accounts"."owner_user_id" IS NULL AND "ledger"."ledger_accounts"."payout_id" IS NULL
            WHEN 'USER_PAYABLE' THEN "ledger"."ledger_accounts"."owner_user_id" IS NOT NULL AND "ledger"."ledger_accounts"."trade_id" IS NULL AND "ledger"."ledger_accounts"."payout_id" IS NULL
            WHEN 'SETTLEMENT_CLEARING' THEN "ledger"."ledger_accounts"."payout_id" IS NOT NULL AND "ledger"."ledger_accounts"."owner_user_id" IS NULL AND "ledger"."ledger_accounts"."trade_id" IS NULL
            ELSE "ledger"."ledger_accounts"."owner_user_id" IS NULL AND "ledger"."ledger_accounts"."trade_id" IS NULL AND "ledger"."ledger_accounts"."payout_id" IS NULL
          END);
