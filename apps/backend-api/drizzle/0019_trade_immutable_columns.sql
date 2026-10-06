-- Design §6.5 and §6.3: the facts a trade is judged on cannot be restated after the fact.
--
-- The fee snapshot is the one that matters most. A trade keeps the fees it was accepted under, so a
-- later edit to config/fees.yaml — or a support tool, or a migration script — must not change an
-- open trade's maths. The snapshot may be written once, onto a trade that has none, and never
-- again. SQLSTATE KT011 names the column that was refused.
--
-- The inspection window moves in one direction only: BEI1 lets a buyer ask for more time, and
-- nothing may take time away from them (T-049 caps the extension). The delivery grace window has no
-- such affordance — no screen offers to change it — so it is frozen outright; an extension of the
-- *delivery deadline* (DE1/DE2) is a trade_deadlines row, not an edit to the snapshot.
--
-- The accepted terms version is frozen once pinned, and status_revision only counts upwards: both
-- are what the state machine's guard and audit trail are keyed on.
--
-- A party may be bound (NULL to a user, when an invitation is claimed) but never swapped: rebinding
-- a buyer mid-trade would redirect an escrow payout to someone the other side never agreed to.
CREATE FUNCTION trade.freeze_immutable_columns() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, trade AS $$
DECLARE
  frozen text;
BEGIN
  frozen := CASE
    WHEN NEW.trade_code IS DISTINCT FROM OLD.trade_code THEN 'trade_code'
    WHEN NEW.initiator_user_id IS DISTINCT FROM OLD.initiator_user_id THEN 'initiator_user_id'
    WHEN NEW.initiator_role IS DISTINCT FROM OLD.initiator_role THEN 'initiator_role'
    WHEN NEW.currency IS DISTINCT FROM OLD.currency THEN 'currency'
    WHEN NEW.created_at IS DISTINCT FROM OLD.created_at THEN 'created_at'
    WHEN OLD.buyer_user_id IS NOT NULL AND NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id
      THEN 'buyer_user_id'
    WHEN OLD.seller_user_id IS NOT NULL AND NEW.seller_user_id IS DISTINCT FROM OLD.seller_user_id
      THEN 'seller_user_id'
    WHEN NEW.inspection_window_hours < OLD.inspection_window_hours THEN 'inspection_window_hours'
    WHEN NEW.delivery_grace_hours IS DISTINCT FROM OLD.delivery_grace_hours THEN 'delivery_grace_hours'
    WHEN NEW.status_revision < OLD.status_revision THEN 'status_revision'
    WHEN OLD.accepted_terms_version_id IS NOT NULL
      AND NEW.accepted_terms_version_id IS DISTINCT FROM OLD.accepted_terms_version_id
      THEN 'accepted_terms_version_id'
    WHEN OLD.fee_schedule_version IS NOT NULL THEN CASE
      WHEN NEW.fee_schedule_version IS DISTINCT FROM OLD.fee_schedule_version THEN 'fee_schedule_version'
      WHEN NEW.item_amount_minor IS DISTINCT FROM OLD.item_amount_minor THEN 'item_amount_minor'
      WHEN NEW.buyer_protection_fee_minor IS DISTINCT FROM OLD.buyer_protection_fee_minor
        THEN 'buyer_protection_fee_minor'
      WHEN NEW.buyer_total_minor IS DISTINCT FROM OLD.buyer_total_minor THEN 'buyer_total_minor'
      WHEN NEW.commission_minor IS DISTINCT FROM OLD.commission_minor THEN 'commission_minor'
      WHEN NEW.seller_proceeds_minor IS DISTINCT FROM OLD.seller_proceeds_minor THEN 'seller_proceeds_minor'
      WHEN NEW.platform_revenue_minor IS DISTINCT FROM OLD.platform_revenue_minor THEN 'platform_revenue_minor'
      WHEN NEW.fee_snapshot IS DISTINCT FROM OLD.fee_snapshot THEN 'fee_snapshot'
      WHEN NEW.fees_snapshotted_at IS DISTINCT FROM OLD.fees_snapshotted_at THEN 'fees_snapshotted_at'
      ELSE NULL
    END
    ELSE NULL
  END;

  IF frozen IS NOT NULL THEN
    RAISE EXCEPTION 'komtru: trade %.% cannot be changed once set', OLD.trade_code, frozen
      USING ERRCODE = 'KT011';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trade_freeze_immutable_columns BEFORE UPDATE ON trade.trades
  FOR EACH ROW EXECUTE FUNCTION trade.freeze_immutable_columns();
