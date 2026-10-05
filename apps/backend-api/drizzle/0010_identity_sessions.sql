CREATE TABLE "identity"."account_recovery_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"claimed_identifier_hash" "bytea" NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"evidence_refs" uuid[] DEFAULT '{}' NOT NULL,
	"ticket_id" uuid,
	"risk_score" smallint,
	"requires_human" boolean DEFAULT true NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"decision_reason" text,
	"requested_ip" "inet",
	"requested_device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "recovery_reviewer_not_subject" CHECK ("identity"."account_recovery_requests"."reviewed_by" IS NULL OR "identity"."account_recovery_requests"."user_id" IS NULL OR "identity"."account_recovery_requests"."reviewed_by" <> "identity"."account_recovery_requests"."user_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_fingerprint" text NOT NULL,
	"platform" text NOT NULL,
	"os_version" text,
	"app_version" text,
	"model" text,
	"push_token" text,
	"status" "identity"."device_status" DEFAULT 'ACTIVE' NOT NULL,
	"trusted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "identity"."mfa_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"factor_type" "identity"."mfa_factor_type" NOT NULL,
	"status" "identity"."mfa_factor_status" DEFAULT 'PENDING' NOT NULL,
	"label" text,
	"secret_enc" "bytea",
	"phone_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"purpose" "identity"."otp_purpose" NOT NULL,
	"channel" "identity"."otp_channel" NOT NULL,
	"destination_hash" "bytea" NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "identity"."passkey_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" "bytea" NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"aaguid" uuid,
	"transports" text[] DEFAULT '{}' NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"scope" "identity"."session_scope" DEFAULT 'CONSUMER' NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" "bytea" NOT NULL,
	"parent_session_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"amr" text[] DEFAULT '{}' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "identity"."reserved_usernames" (
	"username_skeleton" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"note" text,
	"releasable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."username_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"username" "citext" NOT NULL,
	"username_skeleton" text NOT NULL,
	"skeleton_version" smallint DEFAULT 1 NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"quarantine_until" timestamp with time zone,
	"changed_by" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "identity"."party_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"channel" "identity"."otp_channel" NOT NULL,
	"destination_hash" "bytea" NOT NULL,
	"destination_masked" text NOT NULL,
	"destination_enc" "bytea" NOT NULL,
	"intended_role" text NOT NULL,
	"context_type" text,
	"context_id" uuid,
	"token_hash" "bytea" NOT NULL,
	"status" "identity"."invitation_status" DEFAULT 'PENDING' NOT NULL,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "identity"."account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_requested_device_id_devices_id_fk" FOREIGN KEY ("requested_device_id") REFERENCES "identity"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."mfa_factors" ADD CONSTRAINT "mfa_factors_phone_id_user_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "identity"."user_phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "identity"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_parent_session_id_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "identity"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."username_history" ADD CONSTRAINT "username_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."username_history" ADD CONSTRAINT "username_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."party_invitations" ADD CONSTRAINT "party_invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."party_invitations" ADD CONSTRAINT "party_invitations_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_recovery_user_idx" ON "identity"."account_recovery_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_recovery_pending_idx" ON "identity"."account_recovery_requests" USING btree ("created_at") WHERE "identity"."account_recovery_requests"."status" IN ('PENDING', 'CHALLENGED');--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_fingerprint" ON "identity"."devices" USING btree ("user_id","device_fingerprint");--> statement-breakpoint
CREATE INDEX "devices_fingerprint_idx" ON "identity"."devices" USING btree ("device_fingerprint");--> statement-breakpoint
CREATE INDEX "mfa_factors_user_idx" ON "identity"."mfa_factors" USING btree ("user_id") WHERE "identity"."mfa_factors"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_factors_one_default" ON "identity"."mfa_factors" USING btree ("user_id") WHERE "identity"."mfa_factors"."is_default" AND "identity"."mfa_factors"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "otp_challenges_lookup" ON "identity"."otp_challenges" USING btree ("destination_hash","purpose") WHERE "identity"."otp_challenges"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "otp_challenges_expiry" ON "identity"."otp_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_hash" ON "identity"."sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "identity"."sessions" USING btree ("user_id") WHERE "identity"."sessions"."revoked_at" IS NULL AND "identity"."sessions"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "identity"."sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "username_history_user_idx" ON "identity"."username_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "username_history_quarantine_idx" ON "identity"."username_history" USING btree ("username_skeleton") WHERE "identity"."username_history"."quarantine_until" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "party_invitations_dest_idx" ON "identity"."party_invitations" USING btree ("destination_hash") WHERE "identity"."party_invitations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "party_invitations_inviter_idx" ON "identity"."party_invitations" USING btree ("inviter_user_id");