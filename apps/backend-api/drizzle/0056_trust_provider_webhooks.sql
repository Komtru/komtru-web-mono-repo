CREATE TYPE "trust"."webhook_status" AS ENUM('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "trust"."provider_webhooks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" "trust"."kyc_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"raw_body_sha256" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"status" "trust"."webhook_status" DEFAULT 'RECEIVED' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"processing_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trust"."verification_requests" ADD COLUMN "provider_session_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "trust_provider_webhooks_dedup" ON "trust"."provider_webhooks" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "trust_provider_webhooks_inflight_idx" ON "trust"."provider_webhooks" USING btree ("received_at") WHERE "trust"."provider_webhooks"."status" IN ('RECEIVED', 'PROCESSING');--> statement-breakpoint
CREATE UNIQUE INDEX "verification_requests_session_ref" ON "trust"."verification_requests" USING btree ("provider_session_ref") WHERE "trust"."verification_requests"."provider_session_ref" IS NOT NULL;