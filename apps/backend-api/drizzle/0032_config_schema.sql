CREATE SCHEMA "config";
--> statement-breakpoint
CREATE TABLE "config"."config_change_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_target" text NOT NULL,
	"namespace_or_flag_code" text NOT NULL,
	"key" text,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"changed_by_admin_id" uuid NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "config_change_log_target" CHECK ("config"."config_change_log"."change_target" IN ('SETTING', 'FLAG'))
);
--> statement-breakpoint
CREATE TABLE "config"."feature_flags" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_id" uuid
);
--> statement-breakpoint
CREATE TABLE "config"."platform_settings" (
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"description" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_id" uuid,
	CONSTRAINT "platform_settings_namespace_key_pk" PRIMARY KEY("namespace","key"),
	CONSTRAINT "platform_settings_value_type" CHECK ("config"."platform_settings"."value_type" IN ('INTEGER', 'BOOLEAN', 'STRING', 'DECIMAL'))
);
--> statement-breakpoint
CREATE INDEX "config_change_log_target_idx" ON "config"."config_change_log" USING btree ("namespace_or_flag_code","occurred_at" DESC);