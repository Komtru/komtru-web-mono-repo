CREATE SCHEMA "merchant";
--> statement-breakpoint
CREATE TYPE "merchant"."application_status" AS ENUM('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "merchant"."badge_type" AS ENUM('VERIFIED_MERCHANT');--> statement-breakpoint
CREATE TYPE "merchant"."business_type" AS ENUM('INDIVIDUAL', 'REGISTERED_BUSINESS');--> statement-breakpoint
CREATE TYPE "merchant"."certification_status" AS ENUM('CERTIFIED', 'SUSPENDED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "merchant"."document_type" AS ENUM('CAC_CERTIFICATE', 'STATUS_REPORT', 'MEMORANDUM', 'DIRECTOR_ID');--> statement-breakpoint
CREATE TYPE "merchant"."event_actor_type" AS ENUM('APPLICANT', 'STAFF', 'SYSTEM');--> statement-breakpoint
CREATE TABLE "merchant"."merchant_application_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"doc_type" "merchant"."document_type" NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant"."merchant_application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" "merchant"."application_status",
	"to_status" "merchant"."application_status" NOT NULL,
	"actor_type" "merchant"."event_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"policy_citation" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_application_events_staff_decision" CHECK ("merchant"."merchant_application_events"."actor_type" <> 'STAFF'
          OR "merchant"."merchant_application_events"."to_status" NOT IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')
          OR (length(btrim(coalesce("merchant"."merchant_application_events"."reason", ''))) > 0
              AND length(btrim(coalesce("merchant"."merchant_application_events"."policy_citation", ''))) > 0)),
	CONSTRAINT "merchant_application_events_staff_actor" CHECK (("merchant"."merchant_application_events"."actor_type" = 'STAFF') = ("merchant"."merchant_application_events"."actor_user_id" IS NOT NULL)
          OR "merchant"."merchant_application_events"."actor_type" = 'APPLICANT')
);
--> statement-breakpoint
CREATE TABLE "merchant"."merchant_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "merchant"."application_status" DEFAULT 'DRAFT' NOT NULL,
	"business_name" text,
	"business_type" "merchant"."business_type",
	"address_line" text,
	"state_id" uuid,
	"city_id" uuid,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"cac_rc_number" text,
	"payout_account_id" uuid,
	"changes_requested" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"case_id" uuid,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_applications_case_after_draft" CHECK ("merchant"."merchant_applications"."status" = 'DRAFT' OR "merchant"."merchant_applications"."case_id" IS NOT NULL),
	CONSTRAINT "merchant_applications_submitted_count" CHECK (("merchant"."merchant_applications"."status" = 'DRAFT') = ("merchant"."merchant_applications"."submission_count" = 0))
);
--> statement-breakpoint
CREATE TABLE "merchant"."merchant_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge" "merchant"."badge_type" NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "merchant"."merchant_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"business_type" "merchant"."business_type" NOT NULL,
	"storefront_slug" text NOT NULL,
	"bio" text,
	"certification_status" "merchant"."certification_status" DEFAULT 'CERTIFIED' NOT NULL,
	"certified_at" timestamp with time zone NOT NULL,
	"certification_ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_profiles_slug_shape" CHECK ("merchant"."merchant_profiles"."storefront_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "merchant_profiles_ended_together" CHECK (("merchant"."merchant_profiles"."certification_status" = 'CERTIFIED') = ("merchant"."merchant_profiles"."certification_ended_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "merchant"."merchant_application_documents" ADD CONSTRAINT "merchant_application_documents_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "merchant"."merchant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."merchant_application_events" ADD CONSTRAINT "merchant_application_events_application_id_merchant_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "merchant"."merchant_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_application_documents_type_unique" ON "merchant"."merchant_application_documents" USING btree ("application_id","doc_type");--> statement-breakpoint
CREATE INDEX "merchant_application_events_application_idx" ON "merchant"."merchant_application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_applications_one_live" ON "merchant"."merchant_applications" USING btree ("user_id") WHERE "merchant"."merchant_applications"."status" IN ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED');--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_applications_case_unique" ON "merchant"."merchant_applications" USING btree ("case_id") WHERE "merchant"."merchant_applications"."case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "merchant_applications_user_idx" ON "merchant"."merchant_applications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "merchant_applications_status_idx" ON "merchant"."merchant_applications" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_badges_one_live" ON "merchant"."merchant_badges" USING btree ("user_id","badge") WHERE "merchant"."merchant_badges"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_profiles_slug_unique" ON "merchant"."merchant_profiles" USING btree ("storefront_slug");--> statement-breakpoint
-- T-055: the status and decision log only grows. A decision's reason and policy citation are worth
-- nothing if the row can be edited afterwards. Generated by appendOnly() in src/db/helpers/appendOnly.ts:
-- UPDATE and DELETE raise KT001 for everyone including the owner, and komtru_app holds INSERT and SELECT only.
CREATE TRIGGER komtru_append_only BEFORE UPDATE OR DELETE ON "merchant"."merchant_application_events" FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "merchant"."merchant_application_events" FROM komtru_app;
--> statement-breakpoint
GRANT INSERT, SELECT ON "merchant"."merchant_application_events" TO komtru_app;
