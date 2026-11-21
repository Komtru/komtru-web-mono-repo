CREATE SCHEMA "logistics";
--> statement-breakpoint
CREATE TYPE "logistics"."company_status" AS ENUM('ENABLED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "logistics"."invitation_channel" AS ENUM('EMAIL', 'PHONE');--> statement-breakpoint
CREATE TYPE "logistics"."invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "logistics"."member_role" AS ENUM('ADMIN', 'OPERATOR');--> statement-breakpoint
CREATE TYPE "logistics"."member_status" AS ENUM('INVITED', 'ACTIVE', 'REMOVED');--> statement-breakpoint
CREATE TYPE "logistics"."package_status" AS ENUM('REQUESTED', 'ACCEPTED', 'REJECTED', 'PICKED_UP', 'PACKAGED', 'SHIPPED', 'DELIVERED');--> statement-breakpoint
CREATE TABLE "logistics"."logistics_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "logistics"."company_status" DEFAULT 'ENABLED' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics"."logistics_company_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "logistics"."member_role" NOT NULL,
	"status" "logistics"."member_status" DEFAULT 'INVITED' NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics"."logistics_member_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "logistics"."member_role" NOT NULL,
	"channel" "logistics"."invitation_channel" NOT NULL,
	"destination_hash" "bytea" NOT NULL,
	"destination_masked" text NOT NULL,
	"destination_enc" "bytea" NOT NULL,
	"status" "logistics"."invitation_status" DEFAULT 'PENDING' NOT NULL,
	"invited_by_user_id" uuid,
	"member_id" uuid,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics"."logistics_package_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"from_status" "logistics"."package_status",
	"to_status" "logistics"."package_status" NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics"."logistics_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"assigned_operator_id" uuid,
	"status" "logistics"."package_status" DEFAULT 'REQUESTED' NOT NULL,
	"tracking_number" text,
	"rejection_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"packaged_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logistics"."logistics_company_members" ADD CONSTRAINT "logistics_company_members_company_id_logistics_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "logistics"."logistics_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics"."logistics_member_invitations" ADD CONSTRAINT "logistics_member_invitations_company_id_logistics_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "logistics"."logistics_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics"."logistics_member_invitations" ADD CONSTRAINT "logistics_member_invitations_member_id_logistics_company_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "logistics"."logistics_company_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics"."logistics_package_status_events" ADD CONSTRAINT "logistics_package_status_events_package_id_logistics_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "logistics"."logistics_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics"."logistics_packages" ADD CONSTRAINT "logistics_packages_company_id_logistics_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "logistics"."logistics_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "logistics_companies_status_idx" ON "logistics"."logistics_companies" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_companies_one_default_uidx" ON "logistics"."logistics_companies" USING btree ("is_default") WHERE "logistics"."logistics_companies"."is_default";--> statement-breakpoint
CREATE INDEX "logistics_company_members_company_idx" ON "logistics"."logistics_company_members" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_company_members_active_user_uidx" ON "logistics"."logistics_company_members" USING btree ("user_id") WHERE "logistics"."logistics_company_members"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_company_members_company_user_live_uidx" ON "logistics"."logistics_company_members" USING btree ("company_id","user_id") WHERE "logistics"."logistics_company_members"."status" IN ('INVITED', 'ACTIVE');--> statement-breakpoint
CREATE INDEX "logistics_member_invitations_dest_idx" ON "logistics"."logistics_member_invitations" USING btree ("destination_hash") WHERE "logistics"."logistics_member_invitations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "logistics_member_invitations_company_idx" ON "logistics"."logistics_member_invitations" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_member_invitations_pending_uidx" ON "logistics"."logistics_member_invitations" USING btree ("company_id","destination_hash") WHERE "logistics"."logistics_member_invitations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "logistics_package_status_events_package_idx" ON "logistics"."logistics_package_status_events" USING btree ("package_id","created_at");--> statement-breakpoint
CREATE INDEX "logistics_packages_company_status_idx" ON "logistics"."logistics_packages" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_packages_trade_live_uidx" ON "logistics"."logistics_packages" USING btree ("trade_id") WHERE "logistics"."logistics_packages"."status" <> 'REJECTED';--> statement-breakpoint
-- Hand-written (T-085). The status history of a package is an audit record, and an audit record is worth
-- nothing if the row can be edited afterwards. Generated by appendOnly() in src/db/helpers/appendOnly.ts:
-- UPDATE and DELETE raise KT001 for everyone including the owner, and komtru_app holds INSERT and SELECT only.
CREATE TRIGGER komtru_append_only BEFORE UPDATE OR DELETE ON "logistics"."logistics_package_status_events" FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "logistics"."logistics_package_status_events" FROM komtru_app;
--> statement-breakpoint
GRANT INSERT, SELECT ON "logistics"."logistics_package_status_events" TO komtru_app;
--> statement-breakpoint
-- Park is the default logistics company (design §7.1): seeded once, ENABLED, with the fixed id
-- PARK_COMPANY_ID in src/modules/logistics/domain/company.ts. No person onboarded it, so no creator.
INSERT INTO "logistics"."logistics_companies" ("id", "name", "status", "is_default")
VALUES ('7a3c0f00-0000-4000-8000-000000000001', 'Komtru Park', 'ENABLED', true)
ON CONFLICT ("id") DO NOTHING;
