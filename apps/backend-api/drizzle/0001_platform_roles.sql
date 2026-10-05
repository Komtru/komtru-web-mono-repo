-- The runtime role and the shared append-only trigger function (T-021).
-- komtru_app is created without LOGIN; the migrator grants LOGIN with POSTGRES_APP_PASSWORD, so no
-- password ever lives in a migration. Roles are cluster-wide, hence the existence check.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'komtru_app') THEN
    CREATE ROLE komtru_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
-- Nothing lives in public, and nobody but the owner may create anything there. Temporary tables are
-- session state, which transaction pooling cannot keep, so they are off too.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO komtru_app', current_database());
END
$$;
--> statement-breakpoint
-- Raised by every append-only table's trigger (helpers/appendOnly.ts). SQLSTATE KT001 lets callers
-- tell this apart from other errors.
CREATE FUNCTION platform.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'komtru: %.% is append-only; % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'KT001';
END
$$;
