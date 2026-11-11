CREATE TYPE "ledger"."refund_scope" AS ENUM('FULL', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "ledger"."refund_status" AS ENUM('REQUESTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "trade"."cancellation_request_reason" AS ENUM('CHANGED_MIND', 'FOUND_CHEAPER', 'ORDERED_BY_MISTAKE', 'OUT_OF_STOCK', 'WRONG_PRICE', 'CANNOT_MEET_TIMELINE', 'OTHER');--> statement-breakpoint
CREATE TYPE "trade"."cancellation_request_status" AS ENUM('PENDING', 'APPROVED', 'DECLINED', 'LAPSED');--> statement-breakpoint
CREATE TABLE "ledger"."refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trade_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"provider" "ledger"."payment_provider" NOT NULL,
	"charge_reference" text NOT NULL,
	"reference" text NOT NULL,
	"scope" "ledger"."refund_scope" NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"currency" text NOT NULL,
	"item_amount_minor" bigint NOT NULL,
	"fee_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_treatment" text NOT NULL,
	"status" "ledger"."refund_status" DEFAULT 'REQUESTED' NOT NULL,
	"provider_refund_id" text,
	"last_provider_status" text,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"failure_reason" text,
	"decision_journal_id" uuid NOT NULL,
	"failed_journal_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_reference_unique" UNIQUE("reference"),
	CONSTRAINT "refunds_currency" CHECK ("ledger"."refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "refunds_reference_shape" CHECK ("ledger"."refunds"."reference" = 'refund-' || "ledger"."refunds"."id"::text),
	CONSTRAINT "refunds_amounts" CHECK ("ledger"."refunds"."item_amount_minor" >= 0 AND "ledger"."refunds"."fee_amount_minor" >= 0 AND "ledger"."refunds"."amount_minor" > 0
          AND "ledger"."refunds"."amount_minor" = "ledger"."refunds"."item_amount_minor" + "ledger"."refunds"."fee_amount_minor"),
	CONSTRAINT "refunds_fee_treatment" CHECK ("ledger"."refunds"."fee_treatment" IN ('REFUND', 'RECOGNISE', 'RETAIN')
          AND ("ledger"."refunds"."fee_treatment" = 'REFUND' OR "ledger"."refunds"."fee_amount_minor" = 0)
          AND ("ledger"."refunds"."scope" = 'FULL' OR "ledger"."refunds"."fee_treatment" = 'RETAIN')),
	CONSTRAINT "refunds_reason" CHECK (length("ledger"."refunds"."reason") BETWEEN 1 AND 64),
	CONSTRAINT "refunds_processed" CHECK (("ledger"."refunds"."status" = 'PROCESSED') = ("ledger"."refunds"."completed_at" IS NOT NULL)),
	CONSTRAINT "refunds_failed_posted" CHECK (("ledger"."refunds"."status" = 'FAILED') = ("ledger"."refunds"."failed_journal_id" IS NOT NULL AND "ledger"."refunds"."failed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "trade"."cancellation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"requested_by_role" "trade"."trade_initiator_role" NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"reason" "trade"."cancellation_request_reason" NOT NULL,
	"note" text,
	"status" "trade"."cancellation_request_status" DEFAULT 'PENDING' NOT NULL,
	"responded_by_user_id" uuid,
	"responded_at" timestamp with time zone,
	"response_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_request_reason_side" CHECK (("trade"."cancellation_requests"."requested_by_role" = 'BUYER' AND "trade"."cancellation_requests"."reason" IN ('CHANGED_MIND', 'FOUND_CHEAPER', 'ORDERED_BY_MISTAKE'))
          OR ("trade"."cancellation_requests"."requested_by_role" = 'SELLER' AND "trade"."cancellation_requests"."reason" IN ('OUT_OF_STOCK', 'WRONG_PRICE', 'CANNOT_MEET_TIMELINE', 'OTHER'))),
	CONSTRAINT "cancellation_request_seller_approved" CHECK ("trade"."cancellation_requests"."requested_by_role" = 'BUYER' OR "trade"."cancellation_requests"."status" = 'APPROVED'),
	CONSTRAINT "cancellation_request_answered" CHECK (("trade"."cancellation_requests"."status" IN ('APPROVED', 'DECLINED')) = ("trade"."cancellation_requests"."responded_at" IS NOT NULL AND "trade"."cancellation_requests"."responded_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "ledger"."refunds" ADD CONSTRAINT "refunds_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "ledger"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."refunds" ADD CONSTRAINT "refunds_decision_journal_id_ledger_journal_entries_id_fk" FOREIGN KEY ("decision_journal_id") REFERENCES "ledger"."ledger_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."refunds" ADD CONSTRAINT "refunds_failed_journal_id_ledger_journal_entries_id_fk" FOREIGN KEY ("failed_journal_id") REFERENCES "ledger"."ledger_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."cancellation_requests" ADD CONSTRAINT "cancellation_requests_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_one_live_full" ON "ledger"."refunds" USING btree ("trade_id") WHERE "ledger"."refunds"."scope" = 'FULL' AND "ledger"."refunds"."status" <> 'FAILED';--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_refund" ON "ledger"."refunds" USING btree ("provider","provider_refund_id") WHERE "ledger"."refunds"."provider_refund_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "refunds_trade_idx" ON "ledger"."refunds" USING btree ("trade_id","requested_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "refunds_buyer_idx" ON "ledger"."refunds" USING btree ("buyer_user_id","requested_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "refunds_attempt_idx" ON "ledger"."refunds" USING btree ("payment_attempt_id");--> statement-breakpoint
CREATE INDEX "refunds_in_flight_idx" ON "ledger"."refunds" USING btree ("status","updated_at") WHERE "ledger"."refunds"."status" IN ('REQUESTED', 'PROCESSING');--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_request_one_pending" ON "trade"."cancellation_requests" USING btree ("trade_id") WHERE "trade"."cancellation_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_request_one_approved" ON "trade"."cancellation_requests" USING btree ("trade_id") WHERE "trade"."cancellation_requests"."status" = 'APPROVED';--> statement-breakpoint
CREATE INDEX "cancellation_request_trade_idx" ON "trade"."cancellation_requests" USING btree ("trade_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
-- F-030 (T-075, T-066), hand-written below this line: the rules drizzle cannot express.
--
-- No foreign key on trade_id or buyer_user_id: the ledger refers to other modules by soft reference
-- only, as every ledger table does. The charge and the journals are the ledger's own, and are real
-- foreign keys above.
--
-- Cumulative refunds against one charge never exceed it (T-075, m8 plan §4: "must hold regardless of
-- what Paystack itself permits"). The charge's attempt row is locked FOR UPDATE before the sum is read,
-- so two refunds against one charge in flight at once queue here and the second sees the first once it
-- commits (each statement in a READ COMMITTED function takes a fresh snapshot). Only a settled charge
-- can be refunded at all. A FAILED refund no longer counts: the ledger took its money back. SQLSTATE
-- KT014.
CREATE FUNCTION ledger.guard_refund_total() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, ledger AS $$
DECLARE
  charged bigint;
  charge_status text;
  already bigint;
BEGIN
  IF NEW.status = 'FAILED' THEN
    RETURN NEW;
  END IF;
  SELECT amount_minor, status::text INTO charged, charge_status
    FROM ledger.payment_attempts WHERE id = NEW.payment_attempt_id FOR UPDATE;
  IF charged IS NULL OR charge_status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'komtru: refund % is against a charge that was never settled', NEW.reference
      USING ERRCODE = 'KT014';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO already
    FROM ledger.refunds
   WHERE payment_attempt_id = NEW.payment_attempt_id AND status <> 'FAILED' AND id <> NEW.id;
  IF already + NEW.amount_minor > charged THEN
    RAISE EXCEPTION 'komtru: refund % would take refunds on its charge to % of %',
      NEW.reference, already + NEW.amount_minor, charged
      USING ERRCODE = 'KT014';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_refund_total BEFORE INSERT OR UPDATE OF amount_minor, status, payment_attempt_id ON "ledger"."refunds" FOR EACH ROW EXECUTE FUNCTION ledger.guard_refund_total();
--> statement-breakpoint
-- A refund only moves forward. What it reverses, how much, how the fee was treated and the journal that
-- decided it are fixed the moment it is written; the provider's refund id and the failure journal are
-- set once. REQUESTED may become PROCESSING (the provider is being asked) or NEEDS_REVIEW (it cannot be
-- sent); PROCESSING may reach any outcome; NEEDS_REVIEW may be resolved by ops (T-076). PROCESSED and
-- FAILED are final in every column. SQLSTATE KT015.
CREATE FUNCTION ledger.guard_refund() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, ledger AS $$
DECLARE
  refused text;
BEGIN
  refused := CASE
    WHEN OLD.status IN ('PROCESSED', 'FAILED')
      AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at')
      THEN 'status ' || OLD.status || ' is final'
    WHEN NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'REQUESTED' AND NEW.status IN ('PROCESSING', 'NEEDS_REVIEW'))
      OR (OLD.status = 'PROCESSING' AND NEW.status IN ('PROCESSED', 'FAILED', 'NEEDS_REVIEW'))
      OR (OLD.status = 'NEEDS_REVIEW' AND NEW.status IN ('PROCESSED', 'FAILED'))
    ) THEN 'status cannot move from ' || OLD.status || ' to ' || NEW.status
    WHEN NEW.id IS DISTINCT FROM OLD.id THEN 'id'
    WHEN NEW.trade_id IS DISTINCT FROM OLD.trade_id THEN 'trade_id'
    WHEN NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id THEN 'buyer_user_id'
    WHEN NEW.payment_attempt_id IS DISTINCT FROM OLD.payment_attempt_id THEN 'payment_attempt_id'
    WHEN NEW.provider IS DISTINCT FROM OLD.provider THEN 'provider'
    WHEN NEW.charge_reference IS DISTINCT FROM OLD.charge_reference THEN 'charge_reference'
    WHEN NEW.reference IS DISTINCT FROM OLD.reference THEN 'reference'
    WHEN NEW.scope IS DISTINCT FROM OLD.scope THEN 'scope'
    WHEN NEW.reason IS DISTINCT FROM OLD.reason THEN 'reason'
    WHEN NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN 'requested_by'
    WHEN NEW.currency IS DISTINCT FROM OLD.currency THEN 'currency'
    WHEN NEW.item_amount_minor IS DISTINCT FROM OLD.item_amount_minor THEN 'item_amount_minor'
    WHEN NEW.fee_amount_minor IS DISTINCT FROM OLD.fee_amount_minor THEN 'fee_amount_minor'
    WHEN NEW.amount_minor IS DISTINCT FROM OLD.amount_minor THEN 'amount_minor'
    WHEN NEW.fee_treatment IS DISTINCT FROM OLD.fee_treatment THEN 'fee_treatment'
    WHEN NEW.decision_journal_id IS DISTINCT FROM OLD.decision_journal_id THEN 'decision_journal_id'
    WHEN NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN 'requested_at'
    WHEN OLD.provider_refund_id IS NOT NULL
      AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id THEN 'provider_refund_id'
    WHEN OLD.failed_journal_id IS NOT NULL
      AND NEW.failed_journal_id IS DISTINCT FROM OLD.failed_journal_id THEN 'failed_journal_id'
    WHEN OLD.dispatched_at IS NOT NULL
      AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN 'dispatched_at'
    ELSE NULL
  END;

  IF refused IS NOT NULL THEN
    RAISE EXCEPTION 'komtru: refund % cannot be changed: %', OLD.reference, refused
      USING ERRCODE = 'KT015';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_refund_guard BEFORE UPDATE ON "ledger"."refunds" FOR EACH ROW EXECUTE FUNCTION ledger.guard_refund();
--> statement-breakpoint
-- A refund is money that moved; it never loses its row. `ledger.reject_delete()` is 0043's (KT002).
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "ledger"."refunds" FOR EACH ROW EXECUTE FUNCTION ledger.reject_delete();
--> statement-breakpoint
REVOKE DELETE ON "ledger"."refunds" FROM komtru_app;
--> statement-breakpoint
-- T-066: a cancellation request is answered once. Who asked, why and when never change; a PENDING
-- request may be APPROVED, DECLINED or LAPSED, and every other status is final in every column. A
-- seller's own cancellation (SC1) is written APPROVED and is final from the start. SQLSTATE KT015.
CREATE FUNCTION trade.guard_cancellation_request() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, trade AS $$
BEGIN
  IF OLD.status <> 'PENDING'
     OR NEW.status NOT IN ('APPROVED', 'DECLINED', 'LAPSED')
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.trade_id IS DISTINCT FROM OLD.trade_id
     OR NEW.requested_by_role IS DISTINCT FROM OLD.requested_by_role
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'komtru: cancellation request % cannot be changed from %', OLD.id, OLD.status
      USING ERRCODE = 'KT015';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_cancellation_request_guard BEFORE UPDATE ON "trade"."cancellation_requests" FOR EACH ROW EXECUTE FUNCTION trade.guard_cancellation_request();
