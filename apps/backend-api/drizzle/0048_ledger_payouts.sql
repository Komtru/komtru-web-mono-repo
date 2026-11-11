CREATE TYPE "ledger"."payout_account_status" AS ENUM('PENDING_VERIFICATION', 'VERIFIED', 'FAILED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "ledger"."payout_hold_type" AS ENUM('PAYOUT_HOLD', 'FULL_FREEZE');--> statement-breakpoint
CREATE TYPE "ledger"."payout_mode" AS ENUM('MANUAL', 'AUTO_IMMEDIATE', 'AUTO_DAILY', 'AUTO_WEEKLY', 'AUTO_MONTHLY');--> statement-breakpoint
CREATE TYPE "ledger"."payout_status" AS ENUM('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVERSED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "ledger"."payout_trigger" AS ENUM('MANUAL', 'AUTO_IMMEDIATE', 'AUTO_SWEEP');--> statement-breakpoint
CREATE TABLE "ledger"."payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "ledger"."payment_provider" NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text,
	"account_number_enc" text NOT NULL,
	"account_number_masked" text NOT NULL,
	"account_number_hash" "bytea" NOT NULL,
	"account_name" text,
	"provider_recipient_id" text,
	"name_match_ref" uuid,
	"name_match_result" text,
	"status" "ledger"."payout_account_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"failure_reason" text,
	"verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_accounts_verified" CHECK (("ledger"."payout_accounts"."status" = 'VERIFIED') = ("ledger"."payout_accounts"."verified_at" IS NOT NULL AND "ledger"."payout_accounts"."account_name" IS NOT NULL AND "ledger"."payout_accounts"."provider_recipient_id" IS NOT NULL)
          OR ("ledger"."payout_accounts"."status" = 'DISABLED' AND "ledger"."payout_accounts"."verified_at" IS NOT NULL)),
	CONSTRAINT "payout_accounts_default_verified" CHECK (NOT "ledger"."payout_accounts"."is_default" OR "ledger"."payout_accounts"."status" = 'VERIFIED'),
	CONSTRAINT "payout_accounts_disabled" CHECK (("ledger"."payout_accounts"."status" = 'DISABLED') = ("ledger"."payout_accounts"."disabled_at" IS NOT NULL)),
	CONSTRAINT "payout_accounts_masked" CHECK ("ledger"."payout_accounts"."account_number_masked" ~ '^\*+[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "ledger"."payout_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hold_type" "ledger"."payout_hold_type" NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" text,
	CONSTRAINT "payout_holds_released" CHECK (("ledger"."payout_holds"."released_at" IS NULL) = ("ledger"."payout_holds"."released_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ledger"."payout_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mode" "ledger"."payout_mode" DEFAULT 'MANUAL' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"payout_account_id" uuid NOT NULL,
	"provider" "ledger"."payment_provider" NOT NULL,
	"trigger" "ledger"."payout_trigger" NOT NULL,
	"status" "ledger"."payout_status" DEFAULT 'REQUESTED' NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"fee_schedule_version" text NOT NULL,
	"transfer_amount_minor" bigint NOT NULL,
	"reference" text NOT NULL,
	"provider_transfer_id" text,
	"last_provider_status" text,
	"last_checked_at" timestamp with time zone,
	"failure_reason" text,
	"source_journal_entry_id" uuid,
	"source_trade_id" uuid,
	"sweep_key" text,
	"initiated_journal_id" uuid NOT NULL,
	"settled_journal_id" uuid,
	"reversed_journal_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_reference_unique" UNIQUE("reference"),
	CONSTRAINT "payouts_sweep_key_unique" UNIQUE("sweep_key"),
	CONSTRAINT "payouts_currency" CHECK ("ledger"."payouts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payouts_amounts" CHECK ("ledger"."payouts"."fee_minor" >= 0 AND "ledger"."payouts"."transfer_amount_minor" > 0
          AND "ledger"."payouts"."amount_minor" = "ledger"."payouts"."transfer_amount_minor" + "ledger"."payouts"."fee_minor"),
	CONSTRAINT "payouts_reference_shape" CHECK ("ledger"."payouts"."reference" = 'payout-' || "ledger"."payouts"."id"::text),
	CONSTRAINT "payouts_trigger_source" CHECK (("ledger"."payouts"."trigger" = 'AUTO_IMMEDIATE') = ("ledger"."payouts"."source_journal_entry_id" IS NOT NULL)
          AND ("ledger"."payouts"."trigger" = 'AUTO_SWEEP') = ("ledger"."payouts"."sweep_key" IS NOT NULL)),
	CONSTRAINT "payouts_succeeded_posted" CHECK ("ledger"."payouts"."status" <> 'SUCCEEDED' OR ("ledger"."payouts"."settled_journal_id" IS NOT NULL AND "ledger"."payouts"."completed_at" IS NOT NULL)),
	CONSTRAINT "payouts_reversed_posted" CHECK (("ledger"."payouts"."status" IN ('FAILED', 'REVERSED')) = ("ledger"."payouts"."reversed_journal_id" IS NOT NULL AND "ledger"."payouts"."failed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "ledger"."payouts" ADD CONSTRAINT "payouts_payout_account_id_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "ledger"."payout_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."payouts" ADD CONSTRAINT "payouts_source_journal_entry_id_ledger_journal_entries_id_fk" FOREIGN KEY ("source_journal_entry_id") REFERENCES "ledger"."ledger_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."payouts" ADD CONSTRAINT "payouts_initiated_journal_id_ledger_journal_entries_id_fk" FOREIGN KEY ("initiated_journal_id") REFERENCES "ledger"."ledger_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."payouts" ADD CONSTRAINT "payouts_settled_journal_id_ledger_journal_entries_id_fk" FOREIGN KEY ("settled_journal_id") REFERENCES "ledger"."ledger_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."payouts" ADD CONSTRAINT "payouts_reversed_journal_id_ledger_journal_entries_id_fk" FOREIGN KEY ("reversed_journal_id") REFERENCES "ledger"."ledger_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_accounts_user_idx" ON "ledger"."payout_accounts" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_one_live" ON "ledger"."payout_accounts" USING btree ("user_id","bank_code","account_number_hash") WHERE "ledger"."payout_accounts"."status" IN ('PENDING_VERIFICATION', 'VERIFIED');--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_one_default" ON "ledger"."payout_accounts" USING btree ("user_id") WHERE "ledger"."payout_accounts"."is_default";--> statement-breakpoint
CREATE INDEX "payout_holds_active_idx" ON "ledger"."payout_holds" USING btree ("user_id") WHERE "ledger"."payout_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "payouts_user_idx" ON "ledger"."payouts" USING btree ("user_id","requested_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "payouts_in_flight_idx" ON "ledger"."payouts" USING btree ("status","updated_at") WHERE "ledger"."payouts"."status" IN ('REQUESTED', 'PROCESSING');--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_one_per_source" ON "ledger"."payouts" USING btree ("source_journal_entry_id") WHERE "ledger"."payouts"."source_journal_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_provider_transfer" ON "ledger"."payouts" USING btree ("provider","provider_transfer_id") WHERE "ledger"."payouts"."provider_transfer_id" IS NOT NULL;--> statement-breakpoint
-- T-073, hand-written below this line: the rules drizzle cannot express.
--
-- A payout only ever moves forward. What left the payable, the frozen fee, what the bank is sent, the
-- reference the provider knows it by and the journal that moved it into clearing are fixed the moment
-- it is written; the provider's transfer code and the settling or reversing journal are set once and
-- never re-pointed. REQUESTED may become PROCESSING (the transfer is being asked for) or FAILED (a hold
-- found at dispatch); PROCESSING may reach any outcome; a SUCCEEDED payout may still be REVERSED by the
-- bank; NEEDS_REVIEW may be resolved by ops (T-076). FAILED and REVERSED are final in every column. A
-- replayed webhook therefore finds the payout exactly where the first delivery left it. SQLSTATE
-- KT013 (KT012 is the payment attempt's).
CREATE FUNCTION ledger.guard_payout() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, ledger AS $$
DECLARE
  refused text;
BEGIN
  refused := CASE
    WHEN OLD.status IN ('FAILED', 'REVERSED')
      AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at')
      THEN 'status ' || OLD.status || ' is final'
    WHEN NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'REQUESTED' AND NEW.status IN ('PROCESSING', 'FAILED'))
      OR (OLD.status = 'PROCESSING' AND NEW.status IN ('SUCCEEDED', 'FAILED', 'REVERSED', 'NEEDS_REVIEW'))
      OR (OLD.status = 'SUCCEEDED' AND NEW.status = 'REVERSED')
      OR (OLD.status = 'NEEDS_REVIEW' AND NEW.status IN ('SUCCEEDED', 'FAILED', 'REVERSED'))
    ) THEN 'status cannot move from ' || OLD.status || ' to ' || NEW.status
    WHEN NEW.id IS DISTINCT FROM OLD.id THEN 'id'
    WHEN NEW.user_id IS DISTINCT FROM OLD.user_id THEN 'user_id'
    WHEN NEW.payout_account_id IS DISTINCT FROM OLD.payout_account_id THEN 'payout_account_id'
    WHEN NEW.provider IS DISTINCT FROM OLD.provider THEN 'provider'
    WHEN NEW.trigger IS DISTINCT FROM OLD.trigger THEN 'trigger'
    WHEN NEW.currency IS DISTINCT FROM OLD.currency THEN 'currency'
    WHEN NEW.amount_minor IS DISTINCT FROM OLD.amount_minor THEN 'amount_minor'
    WHEN NEW.fee_minor IS DISTINCT FROM OLD.fee_minor THEN 'fee_minor'
    WHEN NEW.fee_schedule_version IS DISTINCT FROM OLD.fee_schedule_version THEN 'fee_schedule_version'
    WHEN NEW.transfer_amount_minor IS DISTINCT FROM OLD.transfer_amount_minor THEN 'transfer_amount_minor'
    WHEN NEW.reference IS DISTINCT FROM OLD.reference THEN 'reference'
    WHEN NEW.source_journal_entry_id IS DISTINCT FROM OLD.source_journal_entry_id THEN 'source_journal_entry_id'
    WHEN NEW.source_trade_id IS DISTINCT FROM OLD.source_trade_id THEN 'source_trade_id'
    WHEN NEW.sweep_key IS DISTINCT FROM OLD.sweep_key THEN 'sweep_key'
    WHEN NEW.initiated_journal_id IS DISTINCT FROM OLD.initiated_journal_id THEN 'initiated_journal_id'
    WHEN NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN 'requested_at'
    WHEN OLD.provider_transfer_id IS NOT NULL
      AND NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id THEN 'provider_transfer_id'
    WHEN OLD.settled_journal_id IS NOT NULL
      AND NEW.settled_journal_id IS DISTINCT FROM OLD.settled_journal_id THEN 'settled_journal_id'
    WHEN OLD.reversed_journal_id IS NOT NULL
      AND NEW.reversed_journal_id IS DISTINCT FROM OLD.reversed_journal_id THEN 'reversed_journal_id'
    WHEN OLD.dispatched_at IS NOT NULL
      AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN 'dispatched_at'
    WHEN OLD.completed_at IS NOT NULL
      AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN 'completed_at'
    ELSE NULL
  END;

  IF refused IS NOT NULL THEN
    RAISE EXCEPTION 'komtru: payout % cannot be changed: %', OLD.reference, refused
      USING ERRCODE = 'KT013';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_payout_guard BEFORE UPDATE ON "ledger"."payouts" FOR EACH ROW EXECUTE FUNCTION ledger.guard_payout();
--> statement-breakpoint
-- A payout account's number, owner and bank are what every payout to it was sent against, so they
-- never change: a different account is a new row. The resolved name and the provider's recipient are
-- set once. DISABLED is final. Only the default flag, the verification outcome and the T-051 link move.
CREATE FUNCTION ledger.guard_payout_account() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, ledger AS $$
DECLARE
  refused text;
BEGIN
  refused := CASE
    WHEN OLD.status = 'DISABLED'
      AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at')
      THEN 'a disabled account is final'
    WHEN NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'PENDING_VERIFICATION' AND NEW.status IN ('VERIFIED', 'FAILED', 'DISABLED'))
      OR (OLD.status IN ('VERIFIED', 'FAILED') AND NEW.status = 'DISABLED')
    ) THEN 'status cannot move from ' || OLD.status || ' to ' || NEW.status
    WHEN NEW.id IS DISTINCT FROM OLD.id THEN 'id'
    WHEN NEW.user_id IS DISTINCT FROM OLD.user_id THEN 'user_id'
    WHEN NEW.provider IS DISTINCT FROM OLD.provider THEN 'provider'
    WHEN NEW.bank_code IS DISTINCT FROM OLD.bank_code THEN 'bank_code'
    WHEN NEW.account_number_enc IS DISTINCT FROM OLD.account_number_enc THEN 'account_number_enc'
    WHEN NEW.account_number_masked IS DISTINCT FROM OLD.account_number_masked THEN 'account_number_masked'
    WHEN NEW.account_number_hash IS DISTINCT FROM OLD.account_number_hash THEN 'account_number_hash'
    WHEN NEW.created_at IS DISTINCT FROM OLD.created_at THEN 'created_at'
    WHEN OLD.account_name IS NOT NULL
      AND NEW.account_name IS DISTINCT FROM OLD.account_name THEN 'account_name'
    WHEN OLD.provider_recipient_id IS NOT NULL
      AND NEW.provider_recipient_id IS DISTINCT FROM OLD.provider_recipient_id THEN 'provider_recipient_id'
    WHEN OLD.verified_at IS NOT NULL
      AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN 'verified_at'
    ELSE NULL
  END;

  IF refused IS NOT NULL THEN
    RAISE EXCEPTION 'komtru: payout account % cannot be changed: %', OLD.id, refused
      USING ERRCODE = 'KT013';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_payout_account_guard BEFORE UPDATE ON "ledger"."payout_accounts" FOR EACH ROW EXECUTE FUNCTION ledger.guard_payout_account();
--> statement-breakpoint
-- A hold records who stopped whose money and why; only its release may be written, once.
CREATE FUNCTION ledger.guard_payout_hold() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, ledger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'released_at' - 'released_by') IS DISTINCT FROM (to_jsonb(OLD) - 'released_at' - 'released_by')
     OR (OLD.released_at IS NOT NULL AND (NEW.released_at IS DISTINCT FROM OLD.released_at
                                          OR NEW.released_by IS DISTINCT FROM OLD.released_by)) THEN
    RAISE EXCEPTION 'komtru: payout hold % may only be released, once', OLD.id
      USING ERRCODE = 'KT013';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_payout_hold_guard BEFORE UPDATE ON "ledger"."payout_holds" FOR EACH ROW EXECUTE FUNCTION ledger.guard_payout_hold();
--> statement-breakpoint
-- None of the three loses a row: a payout is money that moved, an account is where it went, and a hold
-- is why it did not. `ledger.reject_delete()` is 0043's, and raises KT002 for everyone.
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "ledger"."payouts" FOR EACH ROW EXECUTE FUNCTION ledger.reject_delete();
--> statement-breakpoint
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "ledger"."payout_accounts" FOR EACH ROW EXECUTE FUNCTION ledger.reject_delete();
--> statement-breakpoint
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "ledger"."payout_holds" FOR EACH ROW EXECUTE FUNCTION ledger.reject_delete();
--> statement-breakpoint
REVOKE DELETE ON "ledger"."payouts", "ledger"."payout_accounts", "ledger"."payout_holds" FROM komtru_app;
