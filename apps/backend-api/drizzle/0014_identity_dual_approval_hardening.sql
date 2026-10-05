-- Three holes in migration 0009's guard, all from the trigger seeing only one of the two tables the
-- rule spans:
--
--   1. It fired on the revoke statement too, so an assignment that somehow reached a dual-approval
--      role unapproved could never be taken back by the app — komtru_app cannot disable a trigger,
--      so the guard protecting the grant was what prevented fixing it. A row on its way out
--      confers nothing, so skip it.
--   2. `requires_dual_approval` could be set on a role that already had unapproved live grants,
--      leaving them live and unapproved. The second trigger below refuses that flip.
--   3. The foreign key on role_code takes only a KEY SHARE lock, which a non-key UPDATE of
--      `requires_dual_approval` does not conflict with: a concurrent flip slipped past an in-flight
--      grant with no statement out of order. FOR SHARE on the read makes the two serialise.
CREATE OR REPLACE FUNCTION identity.enforce_dual_approval() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  dual boolean;
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT requires_dual_approval INTO dual FROM identity.roles WHERE code = NEW.role_code FOR SHARE;
  IF dual AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'komtru: role % requires a second approver', NEW.role_code
      USING ERRCODE = 'KT002';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION identity.enforce_dual_approval_backfill() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requires_dual_approval AND NOT OLD.requires_dual_approval
     AND EXISTS (SELECT 1 FROM identity.admin_role_assignments
                  WHERE role_code = NEW.code AND approved_by IS NULL AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'komtru: role % has unapproved live assignments; revoke them first', NEW.code
      USING ERRCODE = 'KT002';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER roles_dual_approval_backfill
  BEFORE UPDATE ON identity.roles
  FOR EACH ROW EXECUTE FUNCTION identity.enforce_dual_approval_backfill();
