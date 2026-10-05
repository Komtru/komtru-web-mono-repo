DROP INDEX "identity"."identity_audit_subject_idx";--> statement-breakpoint
DROP INDEX "identity"."identity_audit_actor_idx";--> statement-breakpoint
DROP INDEX "identity"."identity_audit_action_idx";--> statement-breakpoint
DROP INDEX "identity"."users_created_at_idx";--> statement-breakpoint
CREATE INDEX "identity_audit_subject_idx" ON "identity"."identity_audit_log" USING btree ("subject_user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "identity_audit_actor_idx" ON "identity"."identity_audit_log" USING btree ("actor_user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "identity_audit_action_idx" ON "identity"."identity_audit_log" USING btree ("action","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "identity"."users" USING btree ("created_at" DESC NULLS FIRST);