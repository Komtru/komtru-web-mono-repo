CREATE SCHEMA "trade";
--> statement-breakpoint
CREATE TYPE "trade"."cancellation_reason" AS ENUM('BUYER_WITHDREW', 'SELLER_WITHDREW', 'COUNTERPARTY_INVITE_EXPIRED', 'MUTUAL_AGREEMENT', 'FRAUD_SUSPECTED', 'SYSTEM_TIMEOUT', 'SELLER_CANNOT_FULFIL', 'DELIVERY_OVERDUE');--> statement-breakpoint
CREATE TYPE "trade"."delivery_signal_source" AS ENUM('BUYER_CONFIRMATION', 'SELLER_SELF_REPORT', 'PARTNER_PORTAL', 'PARK_CUSTODY', 'COURIER_API');--> statement-breakpoint
CREATE TYPE "trade"."escrow_action_status" AS ENUM('REQUESTED', 'ACKNOWLEDGED', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "trade"."escrow_action_type" AS ENUM('FUND', 'RELEASE', 'REFUND', 'PARTIAL_REFUND');--> statement-breakpoint
CREATE TYPE "trade"."trade_action" AS ENUM('SEND', 'CLAIM_INVITATION', 'EXPIRE', 'CLEAR_REVIEW', 'REJECT_REVIEW', 'COUNTER_PROPOSE', 'ACCEPT', 'DECLINE', 'CANCEL', 'FUND', 'BEGIN_CUSTODY', 'REFUND_CANCELLATION', 'DELIVERY_SIGNAL', 'CONFIRM_RECEIPT', 'GRACE_ELAPSED', 'COMPLETE', 'INSPECTION_ELAPSED', 'SETTLE', 'DISPUTE', 'RESOLVE_DISPUTE');--> statement-breakpoint
CREATE TYPE "trade"."trade_activity_type" AS ENUM('PROPOSAL_SENT', 'COUNTER_PROPOSED', 'PROPOSAL_ACCEPTED', 'PROPOSAL_DECLINED', 'PROPOSAL_REJECTED', 'PROPOSAL_CLEARED', 'ELIGIBILITY_BLOCKED', 'HOLD_PLACED', 'HOLD_RELEASED', 'DEADLINE_SET', 'DEADLINE_EXTENDED', 'DEADLINE_ELAPSED', 'DELIVERY_SIGNAL_RECORDED', 'ESCROW_ACTION_REQUESTED', 'ESCROW_ACTION_SETTLED', 'NOTE');--> statement-breakpoint
CREATE TYPE "trade"."trade_actor_type" AS ENUM('BUYER', 'SELLER', 'SYSTEM', 'STAFF', 'LEDGER', 'LOGISTICS');--> statement-breakpoint
CREATE TYPE "trade"."trade_deadline_kind" AS ENUM('COUNTERPARTY_EXPIRY', 'PAYMENT', 'DELIVERY', 'UNCONFIRMED_DELIVERY_GRACE', 'INSPECTION', 'MEDIATION');--> statement-breakpoint
CREATE TYPE "trade"."trade_deadline_status" AS ENUM('PENDING', 'MET', 'ELAPSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "trade"."trade_hold_source" AS ENUM('PARK_EXCEPTION', 'RISK', 'ADMIN');--> statement-breakpoint
CREATE TYPE "trade"."trade_initiator_role" AS ENUM('BUYER', 'SELLER');--> statement-breakpoint
CREATE TYPE "trade"."trade_status" AS ENUM('DRAFT', 'PENDING_COUNTERPARTY', 'UNDER_PROPOSAL_REVIEW', 'AWAITING_ACCEPTANCE', 'PENDING_PAYMENT', 'FUNDED', 'SHIPPED', 'UNCONFIRMED_DELIVERY', 'INSPECTION', 'COMPLETED', 'SETTLED', 'DISPUTED', 'RESOLVED_REFUNDED', 'RESOLVED_RELEASED', 'CANCELLED_REFUNDED', 'DECLINED', 'REJECTED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "trade"."trade_activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trade_id" uuid NOT NULL,
	"type" "trade"."trade_activity_type" NOT NULL,
	"actor_type" "trade"."trade_actor_type" NOT NULL,
	"actor_id" uuid,
	"terms_version_id" uuid,
	"summary" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "trade"."trade_state_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trade_id" uuid NOT NULL,
	"from_status" "trade"."trade_status",
	"to_status" "trade"."trade_status" NOT NULL,
	"action" "trade"."trade_action" NOT NULL,
	"actor_type" "trade"."trade_actor_type" NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "trade"."escrow_action_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"action" "trade"."escrow_action_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "trade"."escrow_action_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"ledger_ref" text,
	CONSTRAINT "escrow_requests_amount_positive" CHECK ("trade"."escrow_action_requests"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "trade"."trade_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"source" "trade"."trade_hold_source" NOT NULL,
	"reason" text NOT NULL,
	"placed_by_actor_type" "trade"."trade_actor_type" NOT NULL,
	"placed_by_actor_id" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by_actor_id" uuid,
	"release_reason" text
);
--> statement-breakpoint
CREATE TABLE "trade"."delivery_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"source" "trade"."delivery_signal_source" NOT NULL,
	"reported_by" uuid,
	"shipment_event_id" uuid,
	"evidence" jsonb,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade"."trade_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"kind" "trade"."trade_deadline_kind" NOT NULL,
	"status" "trade"."trade_deadline_status" DEFAULT 'PENDING' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"original_due_at" timestamp with time zone NOT NULL,
	"extension_count" integer DEFAULT 0 NOT NULL,
	"extended_by_actor_type" "trade"."trade_actor_type",
	"extended_by_actor_id" uuid,
	"resolved_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_deadlines_extensions_non_negative" CHECK ("trade"."trade_deadlines"."extension_count" >= 0),
	CONSTRAINT "trade_deadlines_never_shortened" CHECK ("trade"."trade_deadlines"."due_at" >= "trade"."trade_deadlines"."original_due_at")
);
--> statement-breakpoint
CREATE TABLE "trade"."trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_code" text NOT NULL,
	"initiator_user_id" uuid NOT NULL,
	"initiator_role" "trade"."trade_initiator_role" NOT NULL,
	"buyer_user_id" uuid,
	"seller_user_id" uuid,
	"counterparty_invitation_id" uuid,
	"order_id" uuid,
	"category_id" uuid,
	"trade_standard_version" integer,
	"status" "trade"."trade_status" DEFAULT 'DRAFT' NOT NULL,
	"status_action" "trade"."trade_action",
	"status_actor_type" "trade"."trade_actor_type",
	"status_actor_id" uuid,
	"status_reason" text,
	"status_context" jsonb,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"inspection_window_hours" integer NOT NULL,
	"delivery_grace_hours" integer NOT NULL,
	"current_terms_version_id" uuid,
	"accepted_terms_version_id" uuid,
	"fee_schedule_version" text,
	"item_amount_minor" bigint,
	"buyer_protection_fee_minor" bigint,
	"buyer_total_minor" bigint,
	"commission_minor" bigint,
	"seller_payout_minor" bigint,
	"fee_snapshot" jsonb,
	"fees_snapshotted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"counterparty_bound_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"funded_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivery_signalled_at" timestamp with time zone,
	"delivery_confirmed_at" timestamp with time zone,
	"inspection_started_at" timestamp with time zone,
	"inspection_deadline_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" "trade"."cancellation_reason",
	"expired_at" timestamp with time zone,
	"disputed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_trade_code_unique" UNIQUE("trade_code"),
	CONSTRAINT "trades_code_format" CHECK ("trade"."trades"."trade_code" ~ '^KMT-[0-9]{5,8}-NG$'),
	CONSTRAINT "trades_currency" CHECK ("trade"."trades"."currency" = 'NGN'),
	CONSTRAINT "trades_parties_distinct" CHECK ("trade"."trades"."buyer_user_id" IS NULL OR "trade"."trades"."seller_user_id" IS NULL
          OR "trade"."trades"."buyer_user_id" <> "trade"."trades"."seller_user_id"),
	CONSTRAINT "trades_initiator_side" CHECK (("trade"."trades"."initiator_role" = 'BUYER' AND "trade"."trades"."buyer_user_id" = "trade"."trades"."initiator_user_id")
          OR ("trade"."trades"."initiator_role" = 'SELLER' AND "trade"."trades"."seller_user_id" = "trade"."trades"."initiator_user_id")),
	CONSTRAINT "trades_parties_bound" CHECK (("trade"."trades"."buyer_user_id" IS NOT NULL AND "trade"."trades"."seller_user_id" IS NOT NULL)
          OR "trade"."trades"."status" IN ('DRAFT', 'PENDING_COUNTERPARTY', 'EXPIRED', 'CANCELLED')),
	CONSTRAINT "trades_window_positive" CHECK ("trade"."trades"."inspection_window_hours" > 0 AND "trade"."trades"."delivery_grace_hours" > 0),
	CONSTRAINT "trades_fee_snapshot_complete" CHECK (num_nonnulls("trade"."trades"."fee_schedule_version", "trade"."trades"."item_amount_minor", "trade"."trades"."buyer_protection_fee_minor",
                      "trade"."trades"."buyer_total_minor", "trade"."trades"."commission_minor", "trade"."trades"."seller_payout_minor",
                      "trade"."trades"."fee_snapshot", "trade"."trades"."fees_snapshotted_at") IN (0, 8)),
	CONSTRAINT "trades_fee_snapshot_arithmetic" CHECK ("trade"."trades"."fee_schedule_version" IS NULL
          OR ("trade"."trades"."item_amount_minor" > 0
              AND "trade"."trades"."buyer_protection_fee_minor" >= 0
              AND "trade"."trades"."commission_minor" >= 0
              AND "trade"."trades"."seller_payout_minor" >= 0
              AND "trade"."trades"."buyer_total_minor" = "trade"."trades"."item_amount_minor" + "trade"."trades"."buyer_protection_fee_minor"
              AND "trade"."trades"."seller_payout_minor" = "trade"."trades"."item_amount_minor" - "trade"."trades"."commission_minor")),
	CONSTRAINT "trades_fees_before_payment" CHECK ("trade"."trades"."fee_schedule_version" IS NOT NULL OR "trade"."trades"."status" IN ('DRAFT', 'PENDING_COUNTERPARTY', 'UNDER_PROPOSAL_REVIEW', 'AWAITING_ACCEPTANCE', 'DECLINED', 'REJECTED', 'CANCELLED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "trade"."trade_terms_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"proposed_by_user_id" uuid NOT NULL,
	"proposed_by_role" "trade"."trade_initiator_role" NOT NULL,
	"item_amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"item_spec" jsonb NOT NULL,
	"inspection_window_hours" integer NOT NULL,
	"delivery_grace_hours" integer NOT NULL,
	"delivery_address" jsonb NOT NULL,
	"ships_from_address" jsonb NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_terms_amount_positive" CHECK ("trade"."trade_terms_versions"."item_amount_minor" > 0),
	CONSTRAINT "trade_terms_currency" CHECK ("trade"."trade_terms_versions"."currency" = 'NGN'),
	CONSTRAINT "trade_terms_window_positive" CHECK ("trade"."trade_terms_versions"."inspection_window_hours" > 0 AND "trade"."trade_terms_versions"."delivery_grace_hours" > 0),
	CONSTRAINT "trade_terms_delivery_address_shape" CHECK ("trade"."trade_terms_versions"."delivery_address" ?& array['street', 'landmark', 'recipient', 'state_id', 'city_id']),
	CONSTRAINT "trade_terms_ships_from_address_shape" CHECK ("trade"."trade_terms_versions"."ships_from_address" ?& array['street', 'landmark', 'recipient', 'state_id', 'city_id'])
);
--> statement-breakpoint
ALTER TABLE "trade"."trade_activity" ADD CONSTRAINT "trade_activity_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."trade_state_changes" ADD CONSTRAINT "trade_state_changes_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."escrow_action_requests" ADD CONSTRAINT "escrow_action_requests_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."trade_holds" ADD CONSTRAINT "trade_holds_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."delivery_signals" ADD CONSTRAINT "delivery_signals_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."trade_deadlines" ADD CONSTRAINT "trade_deadlines_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade"."trade_terms_versions" ADD CONSTRAINT "trade_terms_versions_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "trade"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trade_activity_trade_idx" ON "trade"."trade_activity" USING btree ("trade_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "trade_activity_type_idx" ON "trade"."trade_activity" USING btree ("type","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "trade_state_changes_trade_idx" ON "trade"."trade_state_changes" USING btree ("trade_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "escrow_requests_one_open" ON "trade"."escrow_action_requests" USING btree ("trade_id","action") WHERE "trade"."escrow_action_requests"."status" IN ('REQUESTED', 'ACKNOWLEDGED');--> statement-breakpoint
CREATE INDEX "escrow_requests_pending_idx" ON "trade"."escrow_action_requests" USING btree ("requested_at") WHERE "trade"."escrow_action_requests"."status" IN ('REQUESTED', 'ACKNOWLEDGED');--> statement-breakpoint
CREATE UNIQUE INDEX "trade_holds_one_active" ON "trade"."trade_holds" USING btree ("trade_id","source") WHERE "trade"."trade_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "trade_holds_active_idx" ON "trade"."trade_holds" USING btree ("trade_id") WHERE "trade"."trade_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "delivery_signals_trade_idx" ON "trade"."delivery_signals" USING btree ("trade_id","reported_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_signals_shipment_event" ON "trade"."delivery_signals" USING btree ("trade_id","source","shipment_event_id") WHERE "trade"."delivery_signals"."shipment_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_deadlines_one_pending" ON "trade"."trade_deadlines" USING btree ("trade_id","kind") WHERE "trade"."trade_deadlines"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "trade_deadlines_due_idx" ON "trade"."trade_deadlines" USING btree ("due_at") WHERE "trade"."trade_deadlines"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "trades_buyer_idx" ON "trade"."trades" USING btree ("buyer_user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "trades_seller_idx" ON "trade"."trades" USING btree ("seller_user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "trades_status_idx" ON "trade"."trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trades_inspection_deadline_idx" ON "trade"."trades" USING btree ("inspection_deadline_at") WHERE "trade"."trades"."status" = 'INSPECTION';--> statement-breakpoint
CREATE UNIQUE INDEX "trade_terms_versions_trade_version" ON "trade"."trade_terms_versions" USING btree ("trade_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_terms_versions_id_trade" ON "trade"."trade_terms_versions" USING btree ("id","trade_id");--> statement-breakpoint
CREATE INDEX "trade_terms_versions_trade_idx" ON "trade"."trade_terms_versions" USING btree ("trade_id","version_number" DESC NULLS FIRST);