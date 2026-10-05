CREATE TABLE "platform"."idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"actor" text NOT NULL,
	"request_hash" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer,
	"response" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_actor_pk" PRIMARY KEY("scope","key","actor")
);
--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "platform"."idempotency_keys" USING btree ("created_at");