-- T-065: the buyer's request for more inspection time (BEI1/BEI2) and the explicit acknowledgement
-- behind Confirm & Release (Z5).
--
-- The one enum is NEW, created and used in this same migration, which is legal. No
-- `ALTER TYPE ... ADD VALUE` appears: the drizzle migrator runs every pending migration in one
-- transaction and a label added to an existing type cannot be used until it commits. The activity
-- labels this ticket needs already exist on `trade_activity_type`.
-- `inspection_extension_once` (unique on deadline_id) is BEI1's "once", enforced by the database.
-- `inspection_acknowledgements` is append-only (the trigger below, from appendOnly()): an
-- acknowledgement that can be edited afterwards is not evidence. Its trade FK is restrict, not cascade.
CREATE TYPE "trade"."inspection_extension_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'LAPSED');--> statement-breakpoint
CREATE TABLE "trade"."inspection_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"statement_code" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_ack_statement_length" CHECK (char_length("trade"."inspection_acknowledgements"."statement_code") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "trade"."inspection_extension_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"deadline_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"extra_hours" integer NOT NULL,
	"note" text,
	"current_due_at" timestamp with time zone NOT NULL,
	"requested_due_at" timestamp with time zone NOT NULL,
	"status" "trade"."inspection_extension_status" DEFAULT 'PENDING' NOT NULL,
	"responded_by_user_id" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_extension_hours_positive" CHECK ("trade"."inspection_extension_requests"."extra_hours" > 0),
	CONSTRAINT "inspection_extension_later" CHECK ("trade"."inspection_extension_requests"."requested_due_at" > "trade"."inspection_extension_requests"."current_due_at"),
	CONSTRAINT "inspection_extension_answered" CHECK (("trade"."inspection_extension_requests"."status" IN ('ACCEPTED', 'DECLINED')) = ("trade"."inspection_extension_requests"."responded_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "trade"."inspection_acknowledgements" ADD CONSTRAINT "inspection_acknowledgements_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."inspection_extension_requests" ADD CONSTRAINT "inspection_extension_requests_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."inspection_extension_requests" ADD CONSTRAINT "inspection_extension_requests_deadline_id_trade_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "trade"."trade_deadlines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_acknowledgements_trade" ON "trade"."inspection_acknowledgements" USING btree ("trade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_extension_once" ON "trade"."inspection_extension_requests" USING btree ("deadline_id");--> statement-breakpoint
CREATE INDEX "inspection_extension_trade_idx" ON "trade"."inspection_extension_requests" USING btree ("trade_id","created_at" DESC NULLS FIRST);
--> statement-breakpoint
CREATE TRIGGER komtru_append_only BEFORE UPDATE OR DELETE ON "trade"."inspection_acknowledgements" FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "trade"."inspection_acknowledgements" FROM komtru_app;
--> statement-breakpoint
GRANT INSERT, SELECT ON "trade"."inspection_acknowledgements" TO komtru_app;
