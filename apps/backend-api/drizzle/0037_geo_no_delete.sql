-- T-046: a city or a state is deactivated, never deleted. Addresses, hubs and trades hold a city id,
-- and a deactivated city must stay readable on them, so no writer may remove the row, this module's
-- code or anyone else's, the owner included. DELETE raises KT002 (KT001 is append-only's UPDATE and
-- DELETE). UPDATE stays allowed: renaming and deactivating are updates. A row trigger does not fire on
-- TRUNCATE, which the test harness uses between tests and which komtru_app cannot do.
CREATE FUNCTION geo.reject_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'komtru: %.% rows are deactivated, never deleted', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'KT002';
END
$$;
--> statement-breakpoint
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "geo"."cities" FOR EACH ROW EXECUTE FUNCTION geo.reject_delete();
--> statement-breakpoint
CREATE TRIGGER komtru_no_delete BEFORE DELETE ON "geo"."states" FOR EACH ROW EXECUTE FUNCTION geo.reject_delete();
--> statement-breakpoint
REVOKE DELETE ON "geo"."cities", "geo"."states" FROM komtru_app;
