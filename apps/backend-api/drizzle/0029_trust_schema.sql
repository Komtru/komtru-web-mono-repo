CREATE SCHEMA "trust";
--> statement-breakpoint
CREATE TYPE "trust"."kyc_provider" AS ENUM('SMILE_IDENTITY', 'YOUVERIFY', 'PREMBLY', 'DOJAH', 'VERIFYME', 'MANUAL', 'FAKE');--> statement-breakpoint
CREATE TYPE "trust"."level_change_actor_type" AS ENUM('PROVIDER_AUTO', 'KYC_ANALYST', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "trust"."level_change_direction" AS ENUM('GRANT', 'REVOKE');--> statement-breakpoint
CREATE TYPE "trust"."verification_request_status" AS ENUM('SUBMITTED', 'PROVIDER_PENDING', 'PROVIDER_PASSED', 'PROVIDER_FAILED', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "trust"."verification_type" AS ENUM('NIN', 'BVN', 'LIVENESS', 'CAC', 'BANK_ACCOUNT_NAME_MATCH', 'ADDRESS', 'DOCUMENT', 'SOCIAL_PROOF');--> statement-breakpoint
CREATE TABLE "trust"."bvn_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"bvn_masked" text NOT NULL,
	"bvn_hash" "bytea" NOT NULL,
	"name_match_score" numeric(5, 2),
	"phone_match" boolean,
	"provider" "trust"."kyc_provider" NOT NULL,
	"provider_reference" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."nin_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"nin_masked" text NOT NULL,
	"nin_hash" "bytea" NOT NULL,
	"name_match_score" numeric(5, 2),
	"dob_match" boolean,
	"provider" "trust"."kyc_provider" NOT NULL,
	"provider_reference" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"verification_type" "trust"."verification_type" NOT NULL,
	"status" "trust"."verification_request_status" DEFAULT 'SUBMITTED' NOT NULL,
	"provider" "trust"."kyc_provider",
	"provider_reference" text,
	"target_level" smallint NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"selfie_storage_ref" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_called_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"rejection_reason" text,
	"metadata" text,
	CONSTRAINT "verification_requests_target_level" CHECK ("trust"."verification_requests"."target_level" BETWEEN 2 AND 4)
);
--> statement-breakpoint
CREATE TABLE "trust"."liveness_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"matched_against" "trust"."verification_type" NOT NULL,
	"match_score" numeric(5, 2) NOT NULL,
	"liveness_passed" boolean NOT NULL,
	"selfie_storage_ref" uuid,
	"provider" "trust"."kyc_provider" NOT NULL,
	"provider_reference" text NOT NULL,
	"failure_reason" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."kyc_provider_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" uuid,
	"provider" "trust"."kyc_provider" NOT NULL,
	"call_type" "trust"."verification_type" NOT NULL,
	"http_status" integer,
	"latency_ms" integer,
	"cost_estimate_kobo" integer,
	"succeeded" boolean NOT NULL,
	"error_kind" text,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."verification_level_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_level" smallint NOT NULL,
	"to_level" smallint NOT NULL,
	"direction" "trust"."level_change_direction" NOT NULL,
	"triggering_request_id" uuid,
	"reason" text NOT NULL,
	"actor_type" "trust"."level_change_actor_type" NOT NULL,
	"actor_id" uuid
);
--> statement-breakpoint
ALTER TABLE "trust"."bvn_verifications" ADD CONSTRAINT "bvn_verifications_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."nin_verifications" ADD CONSTRAINT "nin_verifications_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."liveness_checks" ADD CONSTRAINT "liveness_checks_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."kyc_provider_calls" ADD CONSTRAINT "kyc_provider_calls_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."verification_level_changes" ADD CONSTRAINT "verification_level_changes_triggering_request_id_verification_requests_id_fk" FOREIGN KEY ("triggering_request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bvn_verifications_hash_active_unique" ON "trust"."bvn_verifications" USING btree ("bvn_hash") WHERE "trust"."bvn_verifications"."verified_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bvn_verifications_user_idx" ON "trust"."bvn_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nin_verifications_hash_active_unique" ON "trust"."nin_verifications" USING btree ("nin_hash") WHERE "trust"."nin_verifications"."verified_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "nin_verifications_user_idx" ON "trust"."nin_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_requests_user_idx" ON "trust"."verification_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_requests_status_idx" ON "trust"."verification_requests" USING btree ("status") WHERE "trust"."verification_requests"."status" IN ('PROVIDER_PENDING', 'MANUAL_REVIEW');--> statement-breakpoint
CREATE INDEX "verification_requests_expiry_idx" ON "trust"."verification_requests" USING btree ("expires_at") WHERE "trust"."verification_requests"."status" NOT IN ('APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE UNIQUE INDEX "verification_requests_one_in_flight" ON "trust"."verification_requests" USING btree ("user_id","verification_type") WHERE "trust"."verification_requests"."status" IN ('SUBMITTED', 'PROVIDER_PENDING', 'MANUAL_REVIEW');--> statement-breakpoint
CREATE INDEX "liveness_checks_user_idx" ON "trust"."liveness_checks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kyc_provider_calls_provider_idx" ON "trust"."kyc_provider_calls" USING btree ("provider","called_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "verification_level_changes_user_idx" ON "trust"."verification_level_changes" USING btree ("user_id","occurred_at" DESC NULLS FIRST);