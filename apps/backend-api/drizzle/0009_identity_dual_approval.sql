-- M1 §5.7. "A dual-approval role needs an approver" cannot be a CHECK: the rule lives in another
-- table (roles.requires_dual_approval), and a CHECK may only read its own row. BEFORE INSERT OR
-- UPDATE, so clearing approved_by after the grant is rejected too. SQLSTATE KT002 lets a service
-- tell this apart from a constraint violation (KT001 is the append-only guard).
CREATE FUNCTION identity.enforce_dual_approval() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT requires_dual_approval FROM identity.roles WHERE code = NEW.role_code)
     AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'komtru: role % requires a second approver', NEW.role_code
      USING ERRCODE = 'KT002';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER admin_role_dual_approval
  BEFORE INSERT OR UPDATE ON identity.admin_role_assignments
  FOR EACH ROW EXECUTE FUNCTION identity.enforce_dual_approval();
