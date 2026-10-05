-- M1 §5.4. A simple foreign key on (primary_email_id) alone would accept a pointer at another
-- user's email row, so the key carries the user id too and references user_emails (id, user_id).
--
-- ON DELETE SET NULL (column) is Postgres 15+: without the column list, deleting a contact row would
-- try to null users.id as well. DEFERRABLE INITIALLY DEFERRED because users cascades into
-- user_emails while users points back at it — an immediate check cannot unwind that cycle, and
-- registration writes the pointer in the same transaction as the row it points at.
--
-- drizzle expresses neither clause, so these two constraints live here rather than in users.ts.
ALTER TABLE "identity"."users"
  ADD CONSTRAINT "users_primary_email_fk"
    FOREIGN KEY ("primary_email_id", "id") REFERENCES "identity"."user_emails"("id", "user_id")
    ON DELETE SET NULL ("primary_email_id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "identity"."users"
  ADD CONSTRAINT "users_primary_phone_fk"
    FOREIGN KEY ("primary_phone_id", "id") REFERENCES "identity"."user_phones"("id", "user_id")
    ON DELETE SET NULL ("primary_phone_id") DEFERRABLE INITIALLY DEFERRED;
