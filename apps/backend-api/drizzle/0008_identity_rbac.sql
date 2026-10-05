CREATE TABLE "identity"."social_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "identity"."social_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_username" text,
	"provider_email" "citext",
	"provider_email_verified" boolean DEFAULT false NOT NULL,
	"provider_avatar_url" text,
	"access_token_enc" "bytea",
	"refresh_token_enc" "bytea",
	"token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"raw_profile" jsonb,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"unlinked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."user_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"algorithm" text DEFAULT 'argon2id' NOT NULL,
	"previous_hashes" text[] DEFAULT '{}' NOT NULL,
	"must_change" boolean DEFAULT false NOT NULL,
	"breached_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."admin_action_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"reason" text NOT NULL,
	"payload" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	CONSTRAINT "admin_action_distinct_approver" CHECK ("identity"."admin_action_approvals"."approved_by" IS NULL OR "identity"."admin_action_approvals"."approved_by" <> "identity"."admin_action_approvals"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "identity"."admin_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"approved_by" uuid,
	"reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	CONSTRAINT "admin_role_distinct_approver" CHECK ("identity"."admin_role_assignments"."approved_by" IS NULL OR "identity"."admin_role_assignments"."approved_by" <> "identity"."admin_role_assignments"."granted_by"),
	CONSTRAINT "admin_role_no_self_grant" CHECK ("identity"."admin_role_assignments"."granted_by" <> "identity"."admin_role_assignments"."user_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"is_financial" boolean DEFAULT false NOT NULL,
	"is_destructive" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."role_permissions" (
	"role_code" text NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permissions_role_code_permission_code_pk" PRIMARY KEY("role_code","permission_code")
);
--> statement-breakpoint
CREATE TABLE "identity"."roles" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_staff_role" boolean DEFAULT true NOT NULL,
	"requires_dual_approval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."user_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"capability" "identity"."capability_type" NOT NULL,
	"status" "identity"."capability_status" DEFAULT 'PENDING' NOT NULL,
	"activated_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."social_identities" ADD CONSTRAINT "social_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_action_approvals" ADD CONSTRAINT "admin_action_approvals_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_action_approvals" ADD CONSTRAINT "admin_action_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_action_approvals" ADD CONSTRAINT "admin_action_approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "identity"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_role_assignments" ADD CONSTRAINT "admin_role_assignments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "identity"."roles"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "identity"."permissions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_capabilities" ADD CONSTRAINT "user_capabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_capabilities" ADD CONSTRAINT "user_capabilities_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_identities_provider_subject" ON "identity"."social_identities" USING btree ("provider","provider_user_id") WHERE "identity"."social_identities"."unlinked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "social_identities_one_per_provider" ON "identity"."social_identities" USING btree ("user_id","provider") WHERE "identity"."social_identities"."unlinked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "social_identities_user_idx" ON "identity"."social_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_action_approvals_pending_idx" ON "identity"."admin_action_approvals" USING btree ("action","requested_at") WHERE "identity"."admin_action_approvals"."approved_at" IS NULL AND "identity"."admin_action_approvals"."rejected_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_role_active_unique" ON "identity"."admin_role_assignments" USING btree ("user_id","role_code") WHERE "identity"."admin_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "admin_role_expiry_idx" ON "identity"."admin_role_assignments" USING btree ("expires_at") WHERE "identity"."admin_role_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_capabilities_unique" ON "identity"."user_capabilities" USING btree ("user_id","capability");