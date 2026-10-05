CREATE TABLE "identity"."identity_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"subject_user_id" uuid,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"device_id" uuid,
	"session_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"metadata" jsonb,
	"correlation_id" uuid
);
--> statement-breakpoint
CREATE INDEX "identity_audit_subject_idx" ON "identity"."identity_audit_log" USING btree ("subject_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "identity_audit_actor_idx" ON "identity"."identity_audit_log" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "identity_audit_action_idx" ON "identity"."identity_audit_log" USING btree ("action","occurred_at" DESC NULLS LAST);