-- citext, for the case-insensitive identifiers in M1 §5: usernames, email addresses and provider
-- emails. Installed in public deliberately: an extension's operators are only found by name
-- resolution when their schema is in the default search_path, and a citext column compared through
-- a schema that is not would silently degrade to `text =`. grantRuntimeAccess() grants komtru_app
-- USAGE (never CREATE) on public for the same reason.
--
-- pgcrypto is not installed: gen_random_uuid() has been in pg_catalog since Postgres 13.
CREATE EXTENSION IF NOT EXISTS citext;
