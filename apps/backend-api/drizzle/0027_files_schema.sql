CREATE SCHEMA "files";
--> statement-breakpoint
CREATE TYPE "files"."file_category" AS ENUM('LISTING_IMAGE', 'KYC_DOCUMENT', 'DISPUTE_EVIDENCE', 'CUSTODY_EVIDENCE', 'PROOF_OF_DELIVERY', 'TICKET_ATTACHMENT', 'PROFILE_PHOTO', 'CHAT_ATTACHMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "files"."file_status" AS ENUM('ACTIVE', 'TOMBSTONED');--> statement-breakpoint
CREATE TYPE "files"."file_upload_state" AS ENUM('PENDING', 'RECONCILING', 'READY', 'REJECTED');--> statement-breakpoint
CREATE TYPE "files"."file_visibility" AS ENUM('PUBLIC', 'PRIVATE_OWNER', 'PRIVATE_CASE', 'INTERNAL_ONLY');--> statement-breakpoint
CREATE TYPE "files"."storage_account_status" AS ENUM('ACTIVE', 'NEAR_QUOTA', 'DISABLED');--> statement-breakpoint
CREATE TYPE "files"."storage_pool" AS ENUM('PROFILE', 'CHAT_ATTACHMENT', 'TRADE_ASSET');--> statement-breakpoint
CREATE TABLE "files"."storage_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool" "files"."storage_pool" NOT NULL,
	"label" text NOT NULL,
	"cloud_name" text NOT NULL,
	"credential_env_prefix" text NOT NULL,
	"status" "files"."storage_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"rotation_order" smallint,
	"storage_used_bytes" bigint DEFAULT 0 NOT NULL,
	"credits_used_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"last_usage_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_accounts_label_unique" UNIQUE("label"),
	CONSTRAINT "storage_accounts_cloud_name_unique" UNIQUE("cloud_name"),
	CONSTRAINT "storage_accounts_credential_env_prefix_unique" UNIQUE("credential_env_prefix"),
	CONSTRAINT "storage_accounts_credits_pct_range" CHECK ("files"."storage_accounts"."credits_used_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "files"."storage_pool_rotation" (
	"pool" "files"."storage_pool" PRIMARY KEY NOT NULL,
	"last_account_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files"."file_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"grantee_user_id" uuid,
	"grantee_role" text,
	"granted_reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "file_access_grants_one_grantee_type" CHECK (num_nonnulls("files"."file_access_grants"."grantee_user_id", "files"."file_access_grants"."grantee_role") = 1)
);
--> statement-breakpoint
CREATE TABLE "files"."file_access_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_id" uuid NOT NULL,
	"accessed_by_user_id" uuid,
	"accessed_by_admin_id" uuid,
	"access_granted" boolean NOT NULL,
	"denied_reason" text
);
--> statement-breakpoint
CREATE TABLE "files"."file_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_user_id" uuid NOT NULL,
	"owning_module" text NOT NULL,
	"category" "files"."file_category" NOT NULL,
	"visibility" "files"."file_visibility" NOT NULL,
	"storage_account_id" uuid NOT NULL,
	"storage_object_id" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"upload_state" "files"."file_upload_state" DEFAULT 'PENDING' NOT NULL,
	"finalized_at" timestamp with time zone,
	"status" "files"."file_status" DEFAULT 'ACTIVE' NOT NULL,
	"capture_received_at" timestamp with time zone,
	"capture_hub_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tombstoned_at" timestamp with time zone,
	"tombstoned_reason" text,
	CONSTRAINT "file_records_capture_hub_category" CHECK ("files"."file_records"."capture_hub_id" IS NULL OR "files"."file_records"."category" IN ('CUSTODY_EVIDENCE', 'PROOF_OF_DELIVERY')),
	CONSTRAINT "file_records_tombstone_reason" CHECK ("files"."file_records"."status" <> 'TOMBSTONED' OR "files"."file_records"."tombstoned_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "files"."storage_pool_rotation" ADD CONSTRAINT "storage_pool_rotation_last_account_id_storage_accounts_id_fk" FOREIGN KEY ("last_account_id") REFERENCES "files"."storage_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files"."file_access_grants" ADD CONSTRAINT "file_access_grants_file_id_file_records_id_fk" FOREIGN KEY ("file_id") REFERENCES "files"."file_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files"."file_access_log" ADD CONSTRAINT "file_access_log_file_id_file_records_id_fk" FOREIGN KEY ("file_id") REFERENCES "files"."file_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files"."file_records" ADD CONSTRAINT "file_records_storage_account_id_storage_accounts_id_fk" FOREIGN KEY ("storage_account_id") REFERENCES "files"."storage_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_accounts_singleton_pool" ON "files"."storage_accounts" USING btree ("pool") WHERE "files"."storage_accounts"."pool" IN ('PROFILE', 'CHAT_ATTACHMENT') AND "files"."storage_accounts"."status" <> 'DISABLED';--> statement-breakpoint
CREATE UNIQUE INDEX "storage_accounts_rotation_order_uidx" ON "files"."storage_accounts" USING btree ("pool","rotation_order") WHERE "files"."storage_accounts"."rotation_order" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "file_access_grants_file_idx" ON "files"."file_access_grants" USING btree ("file_id") WHERE "files"."file_access_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_access_grants_live_user_uidx" ON "files"."file_access_grants" USING btree ("file_id","grantee_user_id") WHERE "files"."file_access_grants"."revoked_at" IS NULL AND "files"."file_access_grants"."grantee_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_access_grants_live_role_uidx" ON "files"."file_access_grants" USING btree ("file_id","grantee_role") WHERE "files"."file_access_grants"."revoked_at" IS NULL AND "files"."file_access_grants"."grantee_role" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "file_access_log_file_idx" ON "files"."file_access_log" USING btree ("file_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "file_records_account_object_unique" ON "files"."file_records" USING btree ("storage_account_id","storage_object_id");--> statement-breakpoint
CREATE INDEX "file_records_uploader_idx" ON "files"."file_records" USING btree ("uploader_user_id");--> statement-breakpoint
CREATE INDEX "file_records_category_idx" ON "files"."file_records" USING btree ("category");--> statement-breakpoint
CREATE INDEX "file_records_storage_account_idx" ON "files"."file_records" USING btree ("storage_account_id");--> statement-breakpoint
CREATE INDEX "file_records_pending_idx" ON "files"."file_records" USING btree ("created_at") WHERE "files"."file_records"."upload_state" IN ('PENDING', 'RECONCILING');