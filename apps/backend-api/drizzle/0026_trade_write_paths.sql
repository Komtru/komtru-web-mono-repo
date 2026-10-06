-- Three write paths the state machine does not control on its own, closed here.
--
-- 1. INSERT into trade.trades. The transition guard (0018) only fires on UPDATE, so without this a
--    trade could be created directly at FUNDED or SETTLED with no state-change rows behind it — a
--    trade with no history, which is exactly what the audit log exists to make impossible. Every
--    trade starts at DRAFT and walks the machine from there, test fixtures included.
--
-- 2. INSERT into trade.trade_state_changes. Append-only stops the log being edited; it does not
--    stop a row being invented, with any actor and any occurred_at. Only the recorder trigger may
--    write here, which pg_trigger_depth() distinguishes: a statement a client issued runs at depth
--    0, a statement a trigger issues at depth 1 or more.
--
-- 3. UPDATE of trade.trade_terms_versions. A terms version is the record of what the two parties
--    actually agreed, and design §6.2 makes it the evidence a dispute is decided on. The fee
--    snapshot already protects the payout arithmetic (0019); this protects the agreement it was
--    computed from. The one permitted edit is superseding a version, which only ever happens once.
CREATE FUNCTION trade.guard_initial_status() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, trade AS $$
BEGIN
  IF NEW.status <> 'DRAFT' OR NEW.status_revision <> 0 THEN
    RAISE EXCEPTION 'komtru: a trade starts at DRAFT and reaches % by transition, not by insert', NEW.status
      USING ERRCODE = 'KT010';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trade_guard_initial_status BEFORE INSERT ON trade.trades
  FOR EACH ROW EXECUTE FUNCTION trade.guard_initial_status();
--> statement-breakpoint
CREATE FUNCTION trade.reject_forged_state_change() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, trade AS $$
BEGIN
  RAISE EXCEPTION 'komtru: trade_state_changes is written by the transition trigger, not by hand'
    USING ERRCODE = 'KT001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER trade_state_changes_no_forgery BEFORE INSERT ON trade.trade_state_changes
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION trade.reject_forged_state_change();
--> statement-breakpoint
CREATE FUNCTION trade.freeze_terms_version() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, trade AS $$
BEGIN
  IF (to_jsonb(NEW) - 'superseded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at') THEN
    RAISE EXCEPTION 'komtru: terms version % of trade % is immutable; counter-propose a new version instead',
      OLD.version_number, OLD.trade_id USING ERRCODE = 'KT011';
  END IF;
  IF OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at THEN
    RAISE EXCEPTION 'komtru: terms version % of trade % was already superseded',
      OLD.version_number, OLD.trade_id USING ERRCODE = 'KT011';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trade_freeze_terms_version BEFORE UPDATE ON trade.trade_terms_versions
  FOR EACH ROW EXECUTE FUNCTION trade.freeze_terms_version();
