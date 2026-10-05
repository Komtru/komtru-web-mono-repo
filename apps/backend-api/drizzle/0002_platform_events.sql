CREATE TABLE "platform"."outbox" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"version" integer NOT NULL,
	"aggregate_type" text,
	"aggregate_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid,
	"causation_id" uuid,
	"actor" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."processed_events" (
	"event_id" uuid NOT NULL,
	"subscriber" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_event_id_subscriber_pk" PRIMARY KEY("event_id","subscriber")
);
--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "platform"."outbox" USING btree ("seq") WHERE "platform"."outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_published_at_idx" ON "platform"."outbox" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "processed_events_processed_at_idx" ON "platform"."processed_events" USING btree ("processed_at");