CREATE SCHEMA "cases";
--> statement-breakpoint
CREATE TYPE "cases"."case_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "cases"."case_state" AS ENUM('OPEN', 'INVESTIGATING', 'AWAITING_EVIDENCE', 'ESCALATED', 'DECIDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "cases"."case_type" AS ENUM('DISPUTE', 'KYB', 'MERCHANT_APPLICATION', 'IDENTITY', 'FRAUD', 'CUSTODY', 'PAYMENT_EXCEPTION', 'TRADE_PROPOSAL', 'PARK_HUB_APPLICATION');--> statement-breakpoint
CREATE TYPE "cases"."evidence_request_status" AS ENUM('OPEN', 'FULFILLED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "cases"."case_trail_type" AS ENUM('REGISTERED', 'TAKEN', 'REASSIGNED', 'PRIORITY_CHANGED', 'ESCALATED', 'EVIDENCE_REQUESTED', 'EVIDENCE_RESOLVED', 'FACTS_UPDATED', 'DECISION_RECORDED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "cases"."cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "cases"."cases_case_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "cases"."case_type" NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"title" text NOT NULL,
	"state" "cases"."case_state" DEFAULT 'OPEN' NOT NULL,
	"priority" "cases"."case_priority" DEFAULT 'NORMAL' NOT NULL,
	"owner_user_id" uuid,
	"sla_hours" integer NOT NULL,
	"sla_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"escalated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_title_not_blank" CHECK (length(btrim("cases"."cases"."title")) > 0),
	CONSTRAINT "cases_subject_not_blank" CHECK (length("cases"."cases"."subject_type") > 0 AND length("cases"."cases"."subject_id") > 0),
	CONSTRAINT "cases_sla_positive" CHECK ("cases"."cases"."sla_hours" > 0)
);
--> statement-breakpoint
CREATE TABLE "cases"."case_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"policy_citation" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_decisions_outcome_not_blank" CHECK (length(btrim("cases"."case_decisions"."outcome")) > 0),
	CONSTRAINT "case_decisions_reason_not_blank" CHECK (length(btrim("cases"."case_decisions"."reason")) > 0),
	CONSTRAINT "case_decisions_citation_not_blank" CHECK (length(btrim("cases"."case_decisions"."policy_citation")) > 0)
);
--> statement-breakpoint
CREATE TABLE "cases"."case_evidence_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"description" text NOT NULL,
	"from_user_id" uuid,
	"requested_by_user_id" uuid NOT NULL,
	"status" "cases"."evidence_request_status" DEFAULT 'OPEN' NOT NULL,
	"due_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_evidence_requests_description_not_blank" CHECK (length(btrim("cases"."case_evidence_requests"."description")) > 0),
	CONSTRAINT "case_evidence_requests_resolved_together" CHECK (("cases"."case_evidence_requests"."status" = 'OPEN') = ("cases"."case_evidence_requests"."resolved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "cases"."case_trail" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"case_id" uuid NOT NULL,
	"type" "cases"."case_trail_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"metadata" jsonb,
	CONSTRAINT "case_trail_reason_not_blank" CHECK ("cases"."case_trail"."reason" IS NULL OR length(btrim("cases"."case_trail"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "cases"."case_decisions" ADD CONSTRAINT "case_decisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "cases"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases"."case_evidence_requests" ADD CONSTRAINT "case_evidence_requests_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "cases"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases"."case_trail" ADD CONSTRAINT "case_trail_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "cases"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cases_case_number_unique" ON "cases"."cases" USING btree ("case_number");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_subject_unique" ON "cases"."cases" USING btree ("type","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "cases_queue_idx" ON "cases"."cases" USING btree ("sla_due_at","id") WHERE "cases"."cases"."state" NOT IN ('DECIDED', 'CLOSED');--> statement-breakpoint
CREATE INDEX "cases_owner_idx" ON "cases"."cases" USING btree ("owner_user_id","sla_due_at","id") WHERE "cases"."cases"."state" NOT IN ('DECIDED', 'CLOSED');--> statement-breakpoint
CREATE INDEX "cases_state_idx" ON "cases"."cases" USING btree ("state","type");--> statement-breakpoint
CREATE INDEX "case_decisions_case_idx" ON "cases"."case_decisions" USING btree ("case_id","decided_at");--> statement-breakpoint
CREATE INDEX "case_evidence_requests_case_idx" ON "cases"."case_evidence_requests" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "case_trail_case_idx" ON "cases"."case_trail" USING btree ("case_id","id");