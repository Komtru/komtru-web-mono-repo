CREATE TYPE "ledger"."payment_attempt_status" AS ENUM('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TABLE "ledger"."payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"provider" "ledger"."payment_provider" NOT NULL,
	"reference" text NOT NULL,
	"provider_reference" text,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"fee_schedule_version" text NOT NULL,
	"item_amount_minor" bigint NOT NULL,
	"buyer_protection_fee_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "ledger"."payment_attempt_status" DEFAULT 'INITIATED' NOT NULL,
	"last_provider_status" text,
	"last_verified_at" timestamp with time zone,
	"provider_seen_at" timestamp with time zone,
	"last_verify_error" text,
	"last_verify_error_at" timestamp with time zone,
	"verified_amount_minor" bigint,
	"verified_currency" text,
	"journal_entry_id" uuid,
	"failure_reason" text,
	"review_published_at" timestamp with time zone,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pending_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_reference_unique" UNIQUE("reference"),
	CONSTRAINT "payment_attempts_currency" CHECK ("ledger"."payment_attempts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_attempts_amounts" CHECK ("ledger"."payment_attempts"."item_amount_minor" > 0 AND "ledger"."payment_attempts"."buyer_protection_fee_minor" >= 0
          AND "ledger"."payment_attempts"."amount_minor" = "ledger"."payment_attempts"."item_amount_minor" + "ledger"."payment_attempts"."buyer_protection_fee_minor"),
	CONSTRAINT "payment_attempts_reference_shape" CHECK ("ledger"."payment_attempts"."reference" = 'fund-' || "ledger"."payment_attempts"."id"::text),
	CONSTRAINT "payment_attempts_succeeded_posted" CHECK (("ledger"."payment_attempts"."status" = 'SUCCEEDED') = ("ledger"."payment_attempts"."journal_entry_id" IS NOT NULL AND "ledger"."payment_attempts"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "payment_attempts_closed" CHECK (("ledger"."payment_attempts"."status" IN ('FAILED', 'ABANDONED', 'NEEDS_REVIEW')) = ("ledger"."payment_attempts"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ledger"."payment_provider_webhooks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" "ledger"."payment_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"sweep_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_provider_webhooks_signed" CHECK ("ledger"."payment_provider_webhooks"."signature_valid")
);
--> statement-breakpoint
ALTER TABLE "ledger"."payment_attempts" ADD CONSTRAINT "payment_attempts_journal_entry_id_ledger_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "ledger"."ledger_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_attempts_trade_idx" ON "ledger"."payment_attempts" USING btree ("trade_id","initiated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_ref" ON "ledger"."payment_attempts" USING btree ("provider","provider_reference") WHERE "ledger"."payment_attempts"."provider_reference" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_open" ON "ledger"."payment_attempts" USING btree ("trade_id") WHERE "ledger"."payment_attempts"."status" IN ('INITIATED', 'PENDING');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_success" ON "ledger"."payment_attempts" USING btree ("trade_id") WHERE "ledger"."payment_attempts"."status" = 'SUCCEEDED';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_webhooks_dedup" ON "ledger"."payment_provider_webhooks" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_provider_webhooks_unprocessed_idx" ON "ledger"."payment_provider_webhooks" USING btree ("received_at") WHERE "ledger"."payment_provider_webhooks"."processed_at" IS NULL;--> statement-breakpoint
-- T-072, hand-written below this line: the rules drizzle cannot express.
--
-- A payment attempt only ever moves forward. Its identity and its amounts were copied from the
-- trade's fee snapshot when it was created and are what the buyer was asked to pay, so no later
-- write may restate them; the provider reference and the funding posting may be set once and never
-- re-pointed; INITIATED may become PENDING, both may close, and a closed or succeeded attempt is
-- final in every column. A replayed webhook therefore finds the attempt exactly where the first
-- delivery left it. The one exception is `review_published_at`, which a final attempt may have set
-- once: money landing on a closed attempt is announced to ops exactly once. SQLSTATE KT012
-- (KT010/KT011 are the journal's, KT001/KT002 the platform's).
--
-- No foreign keys to trade.trades or identity.users: cross-schema references are plain uuid columns
-- (design §4.2), so each module's migrations and retention stay its own. The one real FK is to this
-- schema's own journal.
CREATE FUNCTION ledger.guard_payment_attempt() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, ledger AS $$
DECLARE
  refused text;
BEGIN
  refused := CASE
    WHEN OLD.review_published_at IS NOT NULL
      AND NEW.review_published_at IS DISTINCT FROM OLD.review_published_at THEN 'review_published_at'
    WHEN OLD.status IN ('SUCCEEDED', 'FAILED', 'ABANDONED', 'NEEDS_REVIEW')
      AND (to_jsonb(NEW) - 'updated_at' - 'review_published_at')
          IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'review_published_at')
      THEN 'status ' || OLD.status || ' is final'
    WHEN OLD.provider_seen_at IS NOT NULL
      AND NEW.provider_seen_at IS DISTINCT FROM OLD.provider_seen_at THEN 'provider_seen_at'
    WHEN OLD.status = 'PENDING' AND NEW.status = 'INITIATED' THEN 'status cannot go back to INITIATED'
    WHEN NEW.id IS DISTINCT FROM OLD.id THEN 'id'
    WHEN NEW.trade_id IS DISTINCT FROM OLD.trade_id THEN 'trade_id'
    WHEN NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id THEN 'buyer_user_id'
    WHEN NEW.provider IS DISTINCT FROM OLD.provider THEN 'provider'
    WHEN NEW.reference IS DISTINCT FROM OLD.reference THEN 'reference'
    WHEN NEW.currency IS DISTINCT FROM OLD.currency THEN 'currency'
    WHEN NEW.fee_schedule_version IS DISTINCT FROM OLD.fee_schedule_version THEN 'fee_schedule_version'
    WHEN NEW.item_amount_minor IS DISTINCT FROM OLD.item_amount_minor THEN 'item_amount_minor'
    WHEN NEW.buyer_protection_fee_minor IS DISTINCT FROM OLD.buyer_protection_fee_minor
      THEN 'buyer_protection_fee_minor'
    WHEN NEW.amount_minor IS DISTINCT FROM OLD.amount_minor THEN 'amount_minor'
    WHEN NEW.initiated_at IS DISTINCT FROM OLD.initiated_at THEN 'initiated_at'
    WHEN OLD.provider_reference IS NOT NULL
      AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN 'provider_reference'
    WHEN OLD.journal_entry_id IS NOT NULL
      AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN 'journal_entry_id'
    ELSE NULL
  END;

  IF refused IS NOT NULL THEN
    RAISE EXCEPTION 'komtru: payment attempt % cannot be changed: %', OLD.reference, refused
      USING ERRCODE = 'KT012';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_payment_attempt_guard BEFORE UPDATE ON "ledger"."payment_attempts" FOR EACH ROW EXECUTE FUNCTION ledger.guard_payment_attempt();
--> statement-breakpoint
-- A delivery is evidence: only its processing outcome may be written, once, and the replay and
-- sweep counters only count up. Until it is processed its processing_error may change: the sweep
-- marks an exhausted delivery, and a later successful run clears that mark.
CREATE FUNCTION ledger.guard_payment_webhook() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, ledger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'processed_at' - 'processing_error' - 'duplicate_count' - 'sweep_count')
       IS DISTINCT FROM (to_jsonb(OLD) - 'processed_at' - 'processing_error' - 'duplicate_count' - 'sweep_count')
     OR (OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at)
     OR (OLD.processed_at IS NOT NULL AND NEW.processing_error IS DISTINCT FROM OLD.processing_error)
     OR NEW.duplicate_count < OLD.duplicate_count
     OR NEW.sweep_count < OLD.sweep_count THEN
    RAISE EXCEPTION 'komtru: payment webhook % may only record its processing outcome', OLD.id
      USING ERRCODE = 'KT012';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_payment_webhook_guard BEFORE UPDATE ON "ledger"."payment_provider_webhooks" FOR EACH ROW EXECUTE FUNCTION ledger.guard_payment_webhook();
--> statement-breakpoint
-- Neither table loses a row: an attempt is what a buyer was charged against, and a delivery is the
-- provider's word. DELETE raises KT002 for everyone, the owner included. A row trigger does not fire
-- on TRUNCATE, which the test harness uses between tests and which komtru_app cannot do.
CREATE FUNCTION ledger.reject_delete() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, ledger AS $$
BEGIN
  RAISE EXCEPTION 'komtru: %.% rows are never deleted', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'KT002';
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "ledger"."payment_attempts" FOR EACH ROW EXECUTE FUNCTION ledger.reject_delete();
--> statement-breakpoint
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "ledger"."payment_provider_webhooks" FOR EACH ROW EXECUTE FUNCTION ledger.reject_delete();
--> statement-breakpoint
-- grantRuntimeAccess() re-grants DELETE on every migrate (it grants all four verbs on any table without
-- the append-only trigger), so this REVOKE is belt and braces; the trigger above is the guard.
REVOKE DELETE ON "ledger"."payment_attempts", "ledger"."payment_provider_webhooks" FROM komtru_app;
