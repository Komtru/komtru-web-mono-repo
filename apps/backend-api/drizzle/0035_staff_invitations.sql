CREATE TABLE "identity"."staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invited_by" uuid NOT NULL,
	"role_code" text NOT NULL,
	"destination_hash" "bytea" NOT NULL,
	"destination_masked" text NOT NULL,
	"destination_enc" "bytea" NOT NULL,
	"reason" text NOT NULL,
	"grant_expires_at" timestamp with time zone,
	"token_hash" "bytea" NOT NULL,
	"status" "identity"."invitation_status" DEFAULT 'PENDING' NOT NULL,
	"bound_user_id" uuid,
	"bound_at" timestamp with time zone,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "identity"."staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."staff_invitations" ADD CONSTRAINT "staff_invitations_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "identity"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."staff_invitations" ADD CONSTRAINT "staff_invitations_bound_user_id_users_id_fk" FOREIGN KEY ("bound_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."staff_invitations" ADD CONSTRAINT "staff_invitations_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."staff_invitations" ADD CONSTRAINT "staff_invitations_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_invitations_dest_idx" ON "identity"."staff_invitations" USING btree ("destination_hash") WHERE "identity"."staff_invitations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "staff_invitations_invited_by_idx" ON "identity"."staff_invitations" USING btree ("invited_by");