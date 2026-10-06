-- M8 D2: debits equal credits in every journal entry, enforced by the database rather than by a
-- service. A journal entry and its lines are separate statements inside one transaction, so the
-- check has to be DEFERRABLE INITIALLY DEFERRED — it runs once, at COMMIT, when the whole posting
-- is visible. Two constraint triggers call one function:
--   on ledger_journal_entries, so a journal committed with no lines (or too few) is refused;
--   on ledger_entries, so lines written without a journal of this transaction's making are refused.
-- Under READ COMMITTED neither transaction can see the other's uncommitted lines, so two callers
-- each posting half of one entry both fail — the invariant fails closed, never open.
--
-- line_count is what closes the line set. "At least two lines that balance" would let a later
-- transaction append a balanced pair to a posting that committed last week: the journal would still
-- balance, but the posting would no longer be the thing it was when it was published. line_count is
-- declared by the writer, NOT NULL, on an append-only row, so no later transaction can widen it.
--
-- SQLSTATEs: KT010 unbalanced or wrong line count, KT011 a line in another currency than the
-- posting (KT001 is the append-only guard, KT002 identity's dual approval).
CREATE FUNCTION ledger.assert_journal_balanced(p_journal_entry_id uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  v_declared  smallint;
  v_currency  text;
  v_lines     integer;
  -- numeric, not bigint: sum(bigint) returns numeric, and assigning a sum past 2^63 to a bigint
  -- would raise 22003 instead of KT010 — a refusal outside the vocabulary an incident responder
  -- is told to look for. Unreachable with real money; the point is that every refusal here reads
  -- the same way.
  v_debits    numeric;
  v_credits   numeric;
  v_foreign   integer;
BEGIN
  SELECT j.line_count, j.currency INTO v_declared, v_currency
    FROM ledger.ledger_journal_entries j WHERE j.id = p_journal_entry_id;
  IF NOT FOUND THEN
    -- The foreign key makes this unreachable from a line; reachable only if the journal entry was
    -- removed, which the append-only trigger forbids. Fail loudly rather than skip the check.
    RAISE EXCEPTION 'komtru: journal entry % does not exist', p_journal_entry_id USING ERRCODE = 'KT010';
  END IF;

  SELECT count(*),
         COALESCE(sum(e.amount_minor) FILTER (WHERE e.direction = 'DEBIT'), 0),
         COALESCE(sum(e.amount_minor) FILTER (WHERE e.direction = 'CREDIT'), 0),
         count(*) FILTER (WHERE a.currency <> v_currency)
    INTO v_lines, v_debits, v_credits, v_foreign
    FROM ledger.ledger_entries e
    JOIN ledger.ledger_accounts a ON a.id = e.account_id
   WHERE e.journal_entry_id = p_journal_entry_id;

  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'komtru: journal entry % is in % but % of its lines are not',
      p_journal_entry_id, v_currency, v_foreign USING ERRCODE = 'KT011';
  END IF;

  IF v_lines <> v_declared THEN
    RAISE EXCEPTION 'komtru: journal entry % declares % lines but has %',
      p_journal_entry_id, v_declared, v_lines USING ERRCODE = 'KT010';
  END IF;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'komtru: journal entry % is unbalanced: debits % credits %',
      p_journal_entry_id, v_debits, v_credits USING ERRCODE = 'KT010';
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION ledger.journal_entry_balanced() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger.assert_journal_balanced(NEW.id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION ledger.ledger_entry_balanced() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger.assert_journal_balanced(NEW.journal_entry_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_journal_entry_balanced
  AFTER INSERT ON ledger.ledger_journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.journal_entry_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entry_balanced
  AFTER INSERT ON ledger.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.ledger_entry_balanced();
