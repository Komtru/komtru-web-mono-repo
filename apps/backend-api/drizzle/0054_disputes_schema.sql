CREATE SCHEMA "disputes";
--> statement-breakpoint
CREATE TYPE "disputes"."appeal_outcome" AS ENUM('UPHOLD', 'OVERTURN');--> statement-breakpoint
CREATE TYPE "disputes"."decision_outcome" AS ENUM('REFUND_BUYER_FULL', 'REFUND_BUYER_PARTIAL', 'RELEASE_SELLER_FULL', 'RELEASE_SELLER_PARTIAL');--> statement-breakpoint
CREATE TYPE "disputes"."decision_type" AS ENUM('ORIGINAL', 'MEDIATED', 'APPEAL');--> statement-breakpoint
CREATE TYPE "disputes"."dispute_actor_type" AS ENUM('BUYER', 'SELLER', 'REVIEWER', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "disputes"."dispute_category" AS ENUM('ITEM_NOT_RECEIVED', 'ITEM_NOT_AS_DESCRIBED', 'PAYMENT_ISSUE', 'SELLER_UNRESPONSIVE', 'BUYER_UNRESPONSIVE', 'OTHER');--> statement-breakpoint
CREATE TYPE "disputes"."dispute_creation_path" AS ENUM('DIRECT_FILING', 'TICKET_ESCALATION');--> statement-breakpoint
CREATE TYPE "disputes"."dispute_status" AS ENUM('MEDIATION', 'OPEN_EVIDENCE_COLLECTION', 'UNDER_REVIEW', 'DECIDED', 'APPEALED', 'APPEAL_UNDER_REVIEW', 'CLOSED');--> statement-breakpoint
CREATE TYPE "disputes"."mediation_proposal_status" AS ENUM('PROPOSED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED');--> statement-breakpoint
CREATE TABLE "disputes"."dispute_decision_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dispute_id" uuid NOT NULL,
	"decision_type" "disputes"."decision_type" NOT NULL,
	"decided_by_user_id" uuid,
	"outcome" "disputes"."decision_outcome" NOT NULL,
	"amount_to_buyer_minor" bigint NOT NULL,
	"amount_to_seller_minor" bigint NOT NULL,
	"appeal_outcome" "disputes"."appeal_outcome",
	"rationale" text NOT NULL,
	"agreed_note" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_decision_amounts_nonnegative" CHECK ("disputes"."dispute_decision_log"."amount_to_buyer_minor" >= 0 AND "disputes"."dispute_decision_log"."amount_to_seller_minor" >= 0),
	CONSTRAINT "dispute_decision_rationale_not_blank" CHECK (length(btrim("disputes"."dispute_decision_log"."rationale")) > 0),
	CONSTRAINT "dispute_decision_appeal_outcome_matches_type" CHECK (("disputes"."dispute_decision_log"."decision_type" = 'APPEAL') = ("disputes"."dispute_decision_log"."appeal_outcome" IS NOT NULL)),
	CONSTRAINT "dispute_decision_decider_matches_type" CHECK (("disputes"."dispute_decision_log"."decision_type" = 'MEDIATED') = ("disputes"."dispute_decision_log"."decided_by_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "disputes"."dispute_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "disputes"."dispute_cases_dispute_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"trade_id" uuid NOT NULL,
	"order_id" uuid,
	"source_ticket_id" uuid,
	"buyer_user_id" uuid NOT NULL,
	"seller_user_id" uuid NOT NULL,
	"opened_by_user_id" uuid NOT NULL,
	"category" "disputes"."dispute_category" NOT NULL,
	"status" "disputes"."dispute_status" DEFAULT 'MEDIATION' NOT NULL,
	"creation_path" "disputes"."dispute_creation_path" NOT NULL,
	"opened_reason" text NOT NULL,
	"total_escrow_minor" bigint NOT NULL,
	"mediation_deadline_at" timestamp with time zone NOT NULL,
	"evidence_deadline_at" timestamp with time zone NOT NULL,
	"evidence_reopened_at" timestamp with time zone,
	"assigned_reviewer_id" uuid,
	"assigned_appeal_lead_id" uuid,
	"decided_at" timestamp with time zone,
	"appeal_deadline_at" timestamp with time zone,
	"appeal_filed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_cases_escrow_positive" CHECK ("disputes"."dispute_cases"."total_escrow_minor" > 0),
	CONSTRAINT "dispute_cases_reason_not_blank" CHECK (length(btrim("disputes"."dispute_cases"."opened_reason")) > 0),
	CONSTRAINT "dispute_cases_parties_differ" CHECK ("disputes"."dispute_cases"."buyer_user_id" <> "disputes"."dispute_cases"."seller_user_id"),
	CONSTRAINT "dispute_cases_ticket_only_on_escalation" CHECK (("disputes"."dispute_cases"."creation_path" = 'TICKET_ESCALATION') OR ("disputes"."dispute_cases"."source_ticket_id" IS NULL)),
	CONSTRAINT "dispute_cases_closed_together" CHECK (("disputes"."dispute_cases"."status" = 'CLOSED') = ("disputes"."dispute_cases"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "disputes"."dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"file_ref_id" uuid,
	"note" text,
	"submitted_after_deadline" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_evidence_has_content" CHECK ("disputes"."dispute_evidence"."file_ref_id" IS NOT NULL OR length(btrim(coalesce("disputes"."dispute_evidence"."note", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "disputes"."dispute_mediation_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"proposed_by_user_id" uuid NOT NULL,
	"outcome" "disputes"."decision_outcome" NOT NULL,
	"amount_to_buyer_minor" bigint NOT NULL,
	"amount_to_seller_minor" bigint NOT NULL,
	"note" text,
	"status" "disputes"."mediation_proposal_status" DEFAULT 'PROPOSED' NOT NULL,
	"responded_by_user_id" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_mediation_amounts_nonnegative" CHECK ("disputes"."dispute_mediation_proposals"."amount_to_buyer_minor" >= 0 AND "disputes"."dispute_mediation_proposals"."amount_to_seller_minor" >= 0),
	CONSTRAINT "dispute_mediation_answered_together" CHECK (("disputes"."dispute_mediation_proposals"."status" = 'PROPOSED') = ("disputes"."dispute_mediation_proposals"."responded_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "disputes"."dispute_status_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"from_status" "disputes"."dispute_status",
	"to_status" "disputes"."dispute_status" NOT NULL,
	"action" text NOT NULL,
	"actor_type" "disputes"."dispute_actor_type" NOT NULL,
	"actor_id" uuid,
	"reason" text,
	CONSTRAINT "dispute_status_changes_action_not_blank" CHECK (length(btrim("disputes"."dispute_status_changes"."action")) > 0),
	CONSTRAINT "dispute_status_changes_system_has_no_actor" CHECK (("disputes"."dispute_status_changes"."actor_type" = 'SYSTEM') = ("disputes"."dispute_status_changes"."actor_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "disputes"."dispute_decision_log" ADD CONSTRAINT "dispute_decision_log_dispute_id_dispute_cases_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "disputes"."dispute_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes"."dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_dispute_cases_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "disputes"."dispute_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes"."dispute_mediation_proposals" ADD CONSTRAINT "dispute_mediation_proposals_dispute_id_dispute_cases_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "disputes"."dispute_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes"."dispute_status_changes" ADD CONSTRAINT "dispute_status_changes_dispute_id_dispute_cases_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "disputes"."dispute_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispute_decision_log_dispute_idx" ON "disputes"."dispute_decision_log" USING btree ("dispute_id","decided_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_cases_number_unique" ON "disputes"."dispute_cases" USING btree ("dispute_number");--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_cases_one_active_per_trade" ON "disputes"."dispute_cases" USING btree ("trade_id") WHERE "disputes"."dispute_cases"."status" <> 'CLOSED';--> statement-breakpoint
CREATE INDEX "dispute_cases_status_idx" ON "disputes"."dispute_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dispute_cases_reviewer_idx" ON "disputes"."dispute_cases" USING btree ("assigned_reviewer_id","created_at","id") WHERE "disputes"."dispute_cases"."status" IN ('UNDER_REVIEW', 'APPEAL_UNDER_REVIEW');--> statement-breakpoint
CREATE INDEX "dispute_cases_queue_idx" ON "disputes"."dispute_cases" USING btree ("created_at","id") WHERE "disputes"."dispute_cases"."status" <> 'CLOSED';--> statement-breakpoint
CREATE INDEX "dispute_cases_buyer_idx" ON "disputes"."dispute_cases" USING btree ("buyer_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "dispute_cases_seller_idx" ON "disputes"."dispute_cases" USING btree ("seller_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "dispute_cases_mediation_due_idx" ON "disputes"."dispute_cases" USING btree ("mediation_deadline_at") WHERE "disputes"."dispute_cases"."status" = 'MEDIATION';--> statement-breakpoint
CREATE INDEX "dispute_cases_evidence_due_idx" ON "disputes"."dispute_cases" USING btree ("evidence_deadline_at") WHERE "disputes"."dispute_cases"."status" = 'OPEN_EVIDENCE_COLLECTION';--> statement-breakpoint
CREATE INDEX "dispute_cases_appeal_due_idx" ON "disputes"."dispute_cases" USING btree ("appeal_deadline_at") WHERE "disputes"."dispute_cases"."status" = 'DECIDED';--> statement-breakpoint
CREATE INDEX "dispute_evidence_dispute_idx" ON "disputes"."dispute_evidence" USING btree ("dispute_id","submitted_at","id");--> statement-breakpoint
CREATE INDEX "dispute_evidence_party_idx" ON "disputes"."dispute_evidence" USING btree ("dispute_id","submitted_by_user_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_mediation_one_open_per_party" ON "disputes"."dispute_mediation_proposals" USING btree ("dispute_id","proposed_by_user_id") WHERE "disputes"."dispute_mediation_proposals"."status" = 'PROPOSED';--> statement-breakpoint
CREATE INDEX "dispute_mediation_dispute_idx" ON "disputes"."dispute_mediation_proposals" USING btree ("dispute_id","created_at","id");--> statement-breakpoint
CREATE INDEX "dispute_status_changes_dispute_idx" ON "disputes"."dispute_status_changes" USING btree ("dispute_id","id");