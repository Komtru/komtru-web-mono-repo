CREATE TYPE "trust"."duplicate_flag_status" AS ENUM('OPEN', 'CONFIRMED_DUPLICATE', 'CLEARED_FALSE_POSITIVE', 'ESCALATED');--> statement-breakpoint
CREATE TABLE "trust"."duplicate_identity_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier_type" "trust"."verification_type" NOT NULL,
	"identifier_hash" "bytea" NOT NULL,
	"first_user_id" uuid NOT NULL,
	"conflicting_user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"status" "trust"."duplicate_flag_status" DEFAULT 'OPEN' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"resolution_notes" text,
	CONSTRAINT "duplicate_flags_distinct_users" CHECK ("trust"."duplicate_identity_flags"."first_user_id" <> "trust"."duplicate_identity_flags"."conflicting_user_id")
);
--> statement-breakpoint
ALTER TABLE "trust"."duplicate_identity_flags" ADD CONSTRAINT "duplicate_identity_flags_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_identity_flags_request_unique" ON "trust"."duplicate_identity_flags" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "duplicate_identity_flags_status_idx" ON "trust"."duplicate_identity_flags" USING btree ("status") WHERE "trust"."duplicate_identity_flags"."status" IN ('OPEN', 'ESCALATED');--> statement-breakpoint
CREATE INDEX "duplicate_identity_flags_hash_idx" ON "trust"."duplicate_identity_flags" USING btree ("identifier_hash");