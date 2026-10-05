-- Rebuilding four indexes to put the NULLs where a DESC query wants them. identity_audit_log and
-- users are the two tables that will be large, so once this is live the same change has to happen
-- outside the migrator: drizzle runs every migration in one transaction and Postgres refuses
-- CONCURRENTLY there. Today both tables are empty everywhere, which is the whole of the waiver.
-- migration-safety: allow drop-index-lock (identity_audit_log and users are empty in every environment; the platform is pre-launch, so the ACCESS EXCLUSIVE lock is taken against no reader and no writer)
-- migration-safety: allow index-lock (identity_audit_log and users are empty in every environment; the platform is pre-launch, so each index is built over zero rows and blocks no writer)

DROP INDEX "identity"."identity_audit_subject_idx";--> statement-breakpoint
DROP INDEX "identity"."identity_audit_actor_idx";--> statement-breakpoint
DROP INDEX "identity"."identity_audit_action_idx";--> statement-breakpoint
DROP INDEX "identity"."users_created_at_idx";--> statement-breakpoint
CREATE INDEX "identity_audit_subject_idx" ON "identity"."identity_audit_log" USING btree ("subject_user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "identity_audit_actor_idx" ON "identity"."identity_audit_log" USING btree ("actor_user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "identity_audit_action_idx" ON "identity"."identity_audit_log" USING btree ("action","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "identity"."users" USING btree ("created_at" DESC NULLS FIRST);