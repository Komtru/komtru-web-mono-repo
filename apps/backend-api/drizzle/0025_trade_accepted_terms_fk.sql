-- A trade may only point at its own terms. A foreign key on the column alone would accept another
-- trade's version id, and a trade funded against a price nobody on it agreed to is the worst kind
-- of bug to find after the money has moved — so the key carries the trade id too and references
-- trade_terms_versions (id, trade_id), backed by the unique index of the same name.
--
-- DEFERRABLE INITIALLY DEFERRED because a trade and its first terms version are written in one
-- transaction, each pointing at the other: an immediate check cannot unwind that.
--
-- ON DELETE SET NULL (column) is Postgres 15+; without the column list, deleting a terms version
-- would try to null the trade's own id. drizzle expresses neither clause, so these two constraints
-- live here rather than in trades.ts.
ALTER TABLE "trade"."trades"
  ADD CONSTRAINT "trades_accepted_terms_fk"
    FOREIGN KEY ("accepted_terms_version_id", "id")
    REFERENCES "trade"."trade_terms_versions"("id", "trade_id")
    ON DELETE SET NULL ("accepted_terms_version_id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "trade"."trades"
  ADD CONSTRAINT "trades_current_terms_fk"
    FOREIGN KEY ("current_terms_version_id", "id")
    REFERENCES "trade"."trade_terms_versions"("id", "trade_id")
    ON DELETE SET NULL ("current_terms_version_id") DEFERRABLE INITIALLY DEFERRED;
