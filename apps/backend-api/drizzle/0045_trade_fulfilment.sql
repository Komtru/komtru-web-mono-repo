-- T-064: self-arranged shipment evidence (X2), delivery extension requests (DE1/DE2) and the
-- AWAITING_SHIPMENT substate T-060 deferred to this ticket.
--
-- Every enum here is a NEW type, created and used in this same migration, which is legal. No
-- `ALTER TYPE ... ADD VALUE` appears: the drizzle migrator runs every pending migration in one
-- transaction, and a label added to an existing enum cannot be used until that transaction commits
-- (T-072's lesson). The activity labels this ticket needs already exist on `trade_activity_type`.
-- Its trade FK is ON DELETE restrict, not cascade (a cascaded delete would be refused by that trigger
-- anyway), and `receipt_file_id` is unique so one photo cannot evidence two shipments.
-- `self_arranged_shipments` is append-only (the trigger below, from appendOnly()): a waybill that can
-- be edited afterwards is not evidence.
CREATE TYPE "trade"."delivery_extension_reason" AS ENUM('COURIER_PICKUP_DELAYED', 'RESTOCKING_ITEM', 'ADDRESS_OR_LOGISTICS_ISSUE');--> statement-breakpoint
CREATE TYPE "trade"."delivery_extension_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'LAPSED');--> statement-breakpoint
CREATE TYPE "trade"."fulfilment_substate" AS ENUM('AWAITING_SHIPMENT');--> statement-breakpoint
CREATE TABLE "trade"."delivery_extension_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"deadline_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"reason" "trade"."delivery_extension_reason" NOT NULL,
	"note" text,
	"current_due_at" timestamp with time zone NOT NULL,
	"requested_due_at" timestamp with time zone NOT NULL,
	"status" "trade"."delivery_extension_status" DEFAULT 'PENDING' NOT NULL,
	"responded_by_user_id" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_extension_later" CHECK ("trade"."delivery_extension_requests"."requested_due_at" > "trade"."delivery_extension_requests"."current_due_at"),
	CONSTRAINT "delivery_extension_answered" CHECK (("trade"."delivery_extension_requests"."status" IN ('ACCEPTED', 'DECLINED')) = ("trade"."delivery_extension_requests"."responded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "trade"."self_arranged_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"waybill_number" text NOT NULL,
	"receipt_file_id" uuid NOT NULL,
	"driver_phone" text NOT NULL,
	"vehicle_plate" text NOT NULL,
	"shipped_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "self_arranged_waybill_length" CHECK (char_length("trade"."self_arranged_shipments"."waybill_number") BETWEEN 3 AND 60),
	CONSTRAINT "self_arranged_phone_e164" CHECK ("trade"."self_arranged_shipments"."driver_phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "self_arranged_plate_length" CHECK (char_length("trade"."self_arranged_shipments"."vehicle_plate") BETWEEN 3 AND 14)
);
--> statement-breakpoint
ALTER TABLE "trade"."trades" ADD COLUMN "fulfilment_substate" "trade"."fulfilment_substate";--> statement-breakpoint
ALTER TABLE "trade"."delivery_extension_requests" ADD CONSTRAINT "delivery_extension_requests_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."delivery_extension_requests" ADD CONSTRAINT "delivery_extension_requests_deadline_id_trade_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "trade"."trade_deadlines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."self_arranged_shipments" ADD CONSTRAINT "self_arranged_shipments_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_extension_one_pending" ON "trade"."delivery_extension_requests" USING btree ("deadline_id") WHERE "trade"."delivery_extension_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "delivery_extension_trade_idx" ON "trade"."delivery_extension_requests" USING btree ("trade_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "self_arranged_shipments_trade" ON "trade"."self_arranged_shipments" USING btree ("trade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "self_arranged_receipt_file" ON "trade"."self_arranged_shipments" USING btree ("receipt_file_id");
--> statement-breakpoint
CREATE TRIGGER komtru_append_only BEFORE UPDATE OR DELETE ON "trade"."self_arranged_shipments" FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "trade"."self_arranged_shipments" FROM komtru_app;
--> statement-breakpoint
GRANT INSERT, SELECT ON "trade"."self_arranged_shipments" TO komtru_app;
