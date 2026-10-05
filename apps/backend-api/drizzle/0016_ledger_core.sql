CREATE SCHEMA "ledger";
--> statement-breakpoint
CREATE TYPE "ledger"."ledger_account_type" AS ENUM('PLATFORM_ESCROW_POOL', 'USER_ESCROW_LIABILITY', 'USER_PAYABLE', 'PLATFORM_FEE_REVENUE', 'BUYER_PROTECTION_FEE_REVENUE', 'SETTLEMENT_CLEARING');--> statement-breakpoint
CREATE TYPE "ledger"."ledger_entry_direction" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "ledger"."payment_provider" AS ENUM('PAYSTACK', 'FLUTTERWAVE');--> statement-breakpoint
CREATE TABLE "ledger"."ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_type" "ledger"."ledger_account_type" NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"owner_user_id" uuid,
	"trade_id" uuid,
	"payout_id" uuid,
	"account_key" text GENERATED ALWAYS AS ("currency" || ':' || (CASE "account_type"
    WHEN 'PLATFORM_ESCROW_POOL' THEN 'PLATFORM_ESCROW_POOL'
    WHEN 'USER_ESCROW_LIABILITY' THEN 'USER_ESCROW_LIABILITY'
    WHEN 'USER_PAYABLE' THEN 'USER_PAYABLE'
    WHEN 'PLATFORM_FEE_REVENUE' THEN 'PLATFORM_FEE_REVENUE'
    WHEN 'BUYER_PROTECTION_FEE_REVENUE' THEN 'BUYER_PROTECTION_FEE_REVENUE'
    WHEN 'SETTLEMENT_CLEARING' THEN 'SETTLEMENT_CLEARING'
  END) || ':' || COALESCE("owner_user_id"::text, "trade_id"::text, "payout_id"::text, '-')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_currency" CHECK ("ledger"."ledger_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ledger_accounts_scope" CHECK (CASE "ledger"."ledger_accounts"."account_type"
            WHEN 'USER_ESCROW_LIABILITY' THEN "ledger"."ledger_accounts"."trade_id" IS NOT NULL AND "ledger"."ledger_accounts"."owner_user_id" IS NULL AND "ledger"."ledger_accounts"."payout_id" IS NULL
            WHEN 'USER_PAYABLE' THEN "ledger"."ledger_accounts"."owner_user_id" IS NOT NULL AND "ledger"."ledger_accounts"."trade_id" IS NULL AND "ledger"."ledger_accounts"."payout_id" IS NULL
            WHEN 'SETTLEMENT_CLEARING' THEN "ledger"."ledger_accounts"."payout_id" IS NOT NULL AND "ledger"."ledger_accounts"."owner_user_id" IS NULL AND "ledger"."ledger_accounts"."trade_id" IS NULL
            ELSE "ledger"."ledger_accounts"."owner_user_id" IS NULL AND "ledger"."ledger_accounts"."trade_id" IS NULL AND "ledger"."ledger_accounts"."payout_id" IS NULL
          END)
);
--> statement-breakpoint
CREATE TABLE "ledger"."ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" "ledger"."ledger_entry_direction" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger"."ledger_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger"."ledger_journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"description" text NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"line_count" smallint NOT NULL,
	"trade_id" uuid,
	"escrow_action_request_id" uuid,
	"provider" "ledger"."payment_provider",
	"provider_reference" text,
	"created_by" text DEFAULT 'SYSTEM' NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_journal_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_journal_entries_line_count" CHECK ("ledger"."ledger_journal_entries"."line_count" >= 2),
	CONSTRAINT "ledger_journal_entries_currency" CHECK ("ledger"."ledger_journal_entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ledger_journal_entries_key_shape" CHECK ("ledger"."ledger_journal_entries"."idempotency_key" ~ '^[a-z][a-z0-9_]*:[A-Za-z0-9:._-]+$'),
	CONSTRAINT "ledger_journal_entries_provider_pair" CHECK (("ledger"."ledger_journal_entries"."provider" IS NULL) = ("ledger"."ledger_journal_entries"."provider_reference" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ledger"."ledger_entries" ADD CONSTRAINT "ledger_entries_journal_entry_id_ledger_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "ledger"."ledger_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "ledger"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_key_unique" ON "ledger"."ledger_accounts" USING btree ("account_key");--> statement-breakpoint
CREATE INDEX "ledger_accounts_owner_idx" ON "ledger"."ledger_accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_journal_idx" ON "ledger"."ledger_entries" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger"."ledger_entries" USING btree ("account_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ledger_journal_entries_trade_idx" ON "ledger"."ledger_journal_entries" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "ledger_journal_entries_posted_idx" ON "ledger"."ledger_journal_entries" USING btree ("posted_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);