CREATE SCHEMA "notify";
--> statement-breakpoint
CREATE TYPE "notify"."notification_category" AS ENUM('SECURITY', 'TRADE', 'PAYMENT', 'DISPUTE', 'TICKET', 'MARKETING', 'ACCOUNT');--> statement-breakpoint
CREATE TYPE "notify"."notification_channel" AS ENUM('PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'VOICE', 'IN_APP');--> statement-breakpoint
CREATE TYPE "notify"."notification_status" AS ENUM('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'DEAD_LETTERED', 'SUPPRESSED');--> statement-breakpoint
CREATE TABLE "notify"."notification_event_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"template_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notify"."notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"channel" "notify"."notification_channel" NOT NULL,
	"category" "notify"."notification_category" NOT NULL,
	"locale" text DEFAULT 'en-NG' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"variables" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_security_critical" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notify"."notification_delivery_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded" boolean NOT NULL,
	"error_detail" text
);
--> statement-breakpoint
CREATE TABLE "notify"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer NOT NULL,
	"channel" "notify"."notification_channel" NOT NULL,
	"category" "notify"."notification_category" NOT NULL,
	"status" "notify"."notification_status" DEFAULT 'QUEUED' NOT NULL,
	"rendered_subject" text,
	"rendered_body" text NOT NULL,
	"recipient_masked" text,
	"provider_reference" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_reason" text,
	"correlation_id" uuid,
	CONSTRAINT "notifications_suppressed_has_reason" CHECK ("notify"."notifications"."status" <> 'SUPPRESSED' OR "notify"."notifications"."failed_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notify"."notification_preferences" (
	"user_id" uuid NOT NULL,
	"category" "notify"."notification_category" NOT NULL,
	"channel" "notify"."notification_channel" NOT NULL,
	"opted_in" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_category_channel_pk" PRIMARY KEY("user_id","category","channel")
);
--> statement-breakpoint
CREATE TABLE "notify"."notification_rate_limits" (
	"user_id" uuid NOT NULL,
	"channel" "notify"."notification_channel" NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"send_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notification_rate_limits_user_id_channel_window_started_at_pk" PRIMARY KEY("user_id","channel","window_started_at")
);
--> statement-breakpoint
ALTER TABLE "notify"."notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "notify"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_mappings_pair" ON "notify"."notification_event_mappings" USING btree ("event_name","template_key");--> statement-breakpoint
CREATE INDEX "notification_event_mappings_event_idx" ON "notify"."notification_event_mappings" USING btree ("event_name") WHERE "notify"."notification_event_mappings"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_key_channel_locale" ON "notify"."notification_templates" USING btree ("template_key","channel","locale","version");--> statement-breakpoint
CREATE INDEX "notification_templates_active_idx" ON "notify"."notification_templates" USING btree ("template_key") WHERE "notify"."notification_templates"."active";--> statement-breakpoint
CREATE INDEX "notification_delivery_attempts_notif_idx" ON "notify"."notification_delivery_attempts" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notify"."notifications" USING btree ("user_id","queued_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notify"."notifications" USING btree ("status") WHERE "notify"."notifications"."status" IN ('QUEUED', 'SENDING', 'FAILED');--> statement-breakpoint
CREATE INDEX "notifications_correlation_idx" ON "notify"."notifications" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "notifications_feed_idx" ON "notify"."notifications" USING btree ("user_id","queued_at" DESC NULLS FIRST) WHERE "notify"."notifications"."channel" = 'IN_APP';