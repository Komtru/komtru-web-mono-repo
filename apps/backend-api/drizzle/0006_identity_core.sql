CREATE TABLE "identity"."user_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"email_normal" "citext" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_source" text,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."user_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"country_code" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"reverify_after" timestamp with time zone,
	"carrier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_e164_format" CHECK ("identity"."user_phones"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "identity"."user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"first_name" text,
	"last_name" text,
	"avatar_file_id" uuid,
	"bio" text,
	"date_of_birth" date,
	"gender" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_bio_len" CHECK ("identity"."user_profiles"."bio" IS NULL OR length("identity"."user_profiles"."bio") <= 500)
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"username" "citext",
	"username_skeleton" text,
	"skeleton_version" smallint DEFAULT 1 NOT NULL,
	"username_set_at" timestamp with time zone,
	"username_change_count" integer DEFAULT 0 NOT NULL,
	"status" "identity"."user_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verification_level" "identity"."verification_level" DEFAULT 'UNVERIFIED' NOT NULL,
	"verification_synced_at" timestamp with time zone,
	"primary_email_id" uuid,
	"primary_phone_id" uuid,
	"sessions_epoch" integer DEFAULT 1 NOT NULL,
	"discoverable_by_username" boolean DEFAULT true NOT NULL,
	"discoverable_by_email" boolean DEFAULT true NOT NULL,
	"discoverable_by_phone" boolean DEFAULT true NOT NULL,
	"mfa_required" boolean DEFAULT false NOT NULL,
	"mfa_enrolled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"registered_via" text,
	"registration_ip" "inet",
	"locale" text DEFAULT 'en-NG' NOT NULL,
	"timezone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"terms_version" text,
	"privacy_version" text,
	"consent_recorded_at" timestamp with time zone,
	"consent_ip" "inet",
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"marketing_opt_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"anonymised_at" timestamp with time zone,
	CONSTRAINT "users_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_username_skeleton_unique" UNIQUE("username_skeleton"),
	CONSTRAINT "users_username_format" CHECK ("identity"."users"."username" IS NULL OR "identity"."users"."username"::text ~ '^[a-z][a-z0-9._]{2,29}$'),
	CONSTRAINT "users_username_pair" CHECK (("identity"."users"."username" IS NULL AND "identity"."users"."username_skeleton" IS NULL)
          OR ("identity"."users"."username" IS NOT NULL AND "identity"."users"."username_skeleton" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "identity"."user_emails" ADD CONSTRAINT "user_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_phones" ADD CONSTRAINT "user_phones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_emails_verified_unique" ON "identity"."user_emails" USING btree ("email_normal") WHERE "identity"."user_emails"."verified_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_emails_one_primary" ON "identity"."user_emails" USING btree ("user_id") WHERE "identity"."user_emails"."is_primary";--> statement-breakpoint
CREATE INDEX "user_emails_user_idx" ON "identity"."user_emails" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_emails_email_idx" ON "identity"."user_emails" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_emails_id_user" ON "identity"."user_emails" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_phones_verified_unique" ON "identity"."user_phones" USING btree ("phone_e164") WHERE "identity"."user_phones"."verified_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_phones_one_primary" ON "identity"."user_phones" USING btree ("user_id") WHERE "identity"."user_phones"."is_primary";--> statement-breakpoint
CREATE INDEX "user_phones_user_idx" ON "identity"."user_phones" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_phones_id_user" ON "identity"."user_phones" USING btree ("id","user_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "identity"."users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "identity"."users" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "users_ver_level_idx" ON "identity"."users" USING btree ("verification_level");