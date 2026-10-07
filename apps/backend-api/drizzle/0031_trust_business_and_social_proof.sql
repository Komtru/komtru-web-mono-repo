CREATE TYPE "trust"."address_method" AS ENUM('UTILITY_BILL', 'BANK_STATEMENT', 'PROVIDER_LOOKUP');--> statement-breakpoint
CREATE TYPE "trust"."bank_match_result" AS ENUM('EXACT', 'FUZZY_MATCH', 'MISMATCH');--> statement-breakpoint
CREATE TYPE "trust"."social_proof_platform" AS ENUM('INSTAGRAM', 'X');--> statement-breakpoint
CREATE TYPE "trust"."verification_document_type" AS ENUM('NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'CAC_CERTIFICATE', 'UTILITY_BILL', 'BANK_STATEMENT');--> statement-breakpoint
CREATE TABLE "trust"."bank_account_name_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"account_number_masked" text NOT NULL,
	"bank_code" text NOT NULL,
	"resolved_account_name" text,
	"expected_name" text NOT NULL,
	"match_result" "trust"."bank_match_result" NOT NULL,
	"match_score" numeric(5, 2),
	"provider" "trust"."kyc_provider" NOT NULL,
	"provider_reference" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."business_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cac_rc_number" text NOT NULL,
	"registered_business_name" text NOT NULL,
	"business_type" text,
	"cac_status" text,
	"officers_match" boolean,
	"provider" "trust"."kyc_provider" NOT NULL,
	"provider_reference" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."address_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"address_line1" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"method" "trust"."address_method" NOT NULL,
	"document_ref" uuid,
	"passed" boolean,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."verification_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"document_type" "trust"."verification_document_type" NOT NULL,
	"storage_ref" uuid NOT NULL,
	"authenticity_check_passed" boolean,
	"provider" "trust"."kyc_provider",
	"provider_reference" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trust"."social_proof_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "trust"."social_proof_platform" NOT NULL,
	"handle" text NOT NULL,
	"challenge_code" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trust"."bank_account_name_matches" ADD CONSTRAINT "bank_account_name_matches_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."business_verifications" ADD CONSTRAINT "business_verifications_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."address_checks" ADD CONSTRAINT "address_checks_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."verification_documents" ADD CONSTRAINT "verification_documents_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "trust"."verification_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_account_name_matches_user_idx" ON "trust"."bank_account_name_matches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bank_account_name_matches_account_idx" ON "trust"."bank_account_name_matches" USING btree ("user_id","bank_code","account_number_masked");--> statement-breakpoint
CREATE INDEX "business_verifications_user_idx" ON "trust"."business_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "business_verifications_rc_idx" ON "trust"."business_verifications" USING btree ("cac_rc_number");--> statement-breakpoint
CREATE UNIQUE INDEX "business_verifications_user_active_unique" ON "trust"."business_verifications" USING btree ("user_id") WHERE "trust"."business_verifications"."verified_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "address_checks_user_idx" ON "trust"."address_checks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_documents_user_idx" ON "trust"."verification_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_documents_request_idx" ON "trust"."verification_documents" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_proof_claims_user_platform" ON "trust"."social_proof_claims" USING btree ("user_id","platform") WHERE "trust"."social_proof_claims"."verified" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "social_proof_claims_platform_handle" ON "trust"."social_proof_claims" USING btree ("platform","handle") WHERE "trust"."social_proof_claims"."verified" = true;--> statement-breakpoint
CREATE INDEX "social_proof_claims_user_idx" ON "trust"."social_proof_claims" USING btree ("user_id");