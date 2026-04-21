-- =====================================================================
-- 1) Deferred balance check: per JE, sum(debits) must equal sum(credits)
--    Fires at COMMIT so we can insert lines incrementally inside one trx.
--
--    PostgreSQL CONSTRAINT TRIGGERs must be AFTER ... FOR EACH ROW and do
--    NOT support REFERENCING transition tables, so we use a per-row
--    constraint trigger that re-aggregates the touched JE at commit time.
-- =====================================================================
CREATE OR REPLACE FUNCTION je_check_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_je_id uuid;
  v_debits numeric(19,4);
  v_credits numeric(19,4);
  v_status journal_entry_status;
BEGIN
  v_je_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  IF v_je_id IS NULL THEN RETURN NULL; END IF;

  -- The parent JE may have been deleted (cascade); skip in that case.
  SELECT status INTO v_status FROM journal_entries WHERE id = v_je_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Voided entries can be unbalanced because their reversal exists separately.
  -- Drafts are allowed to be unbalanced (still being authored).
  -- Only POSTED entries are required to balance.
  IF v_status = 'posted' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_debits, v_credits
      FROM journal_entry_lines
      WHERE journal_entry_id = v_je_id;
    IF v_debits <> v_credits THEN
      RAISE EXCEPTION 'journal entry % is unbalanced: debits=% credits=%',
        v_je_id, v_debits, v_credits
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_jel_balance_insert
  AFTER INSERT ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION je_check_balance();

CREATE CONSTRAINT TRIGGER trg_jel_balance_update
  AFTER UPDATE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION je_check_balance();

CREATE CONSTRAINT TRIGGER trg_jel_balance_delete
  AFTER DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION je_check_balance();

-- Also fire when a JE flips draft -> posted (lines may have been balanced
-- earlier, but we want to recheck at the moment of posting).
CREATE OR REPLACE FUNCTION je_check_balance_on_status()
RETURNS TRIGGER AS $$
DECLARE
  v_debits numeric(19,4);
  v_credits numeric(19,4);
BEGIN
  IF NEW.status = 'posted' AND (OLD.status IS DISTINCT FROM 'posted') THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_debits, v_credits
      FROM journal_entry_lines
      WHERE journal_entry_id = NEW.id;
    IF v_debits <> v_credits THEN
      RAISE EXCEPTION 'journal entry % cannot post: debits=% credits=%',
        NEW.id, v_debits, v_credits
        USING ERRCODE = '23514';
    END IF;
    IF v_debits = 0 THEN
      RAISE EXCEPTION 'journal entry % cannot post: no lines', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_check_balance_on_status
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_check_balance_on_status();

-- =====================================================================
-- 2) Posted-immutability triggers
--    Once status = 'posted', the row is locked. Voiding (status -> voided)
--    is allowed only inside a transaction that has set app.allow_void = 'on'.
-- =====================================================================
CREATE OR REPLACE FUNCTION je_protect_posted_row()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'cannot delete posted journal entry %', OLD.id
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF OLD.status = 'posted' THEN
    -- Allowed transitions on posted rows:
    --   posted -> voided  (only when app.allow_void='on')
    IF NEW.status = 'voided' THEN
      IF current_setting('app.allow_void', true) <> 'on' THEN
        RAISE EXCEPTION 'cannot void posted JE % outside controlled void path', OLD.id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    -- All other column changes on a posted row are forbidden.
    IF (NEW.status, NEW.entry_date, NEW.memo, NEW.reference, NEW.source_type, NEW.source_id, NEW.reversed_entry_id, NEW.business_id, NEW.period_id)
       IS DISTINCT FROM
       (OLD.status, OLD.entry_date, OLD.memo, OLD.reference, OLD.source_type, OLD.source_id, OLD.reversed_entry_id, OLD.business_id, OLD.period_id) THEN
      RAISE EXCEPTION 'cannot mutate posted journal entry % (only void path is allowed)', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_protect_posted
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_protect_posted_row();

CREATE OR REPLACE FUNCTION jel_protect_posted_row()
RETURNS TRIGGER AS $$
DECLARE
  v_status journal_entry_status;
  v_je_id uuid;
BEGIN
  v_je_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT status INTO v_status FROM journal_entries WHERE id = v_je_id;
  IF v_status = 'posted' AND current_setting('app.allow_void', true) <> 'on' THEN
    RAISE EXCEPTION 'cannot mutate lines of posted journal entry %', v_je_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jel_protect_posted
  BEFORE UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION jel_protect_posted_row();

-- =====================================================================
-- 3) Closed-period gating
-- =====================================================================
CREATE OR REPLACE FUNCTION je_check_period_open()
RETURNS TRIGGER AS $$
DECLARE
  v_period_status fiscal_period_status;
  v_starts date; v_ends date;
BEGIN
  SELECT status, starts_on, ends_on INTO v_period_status, v_starts, v_ends
    FROM fiscal_periods WHERE id = NEW.period_id;
  IF v_period_status IS NULL THEN
    RAISE EXCEPTION 'fiscal period % not found', NEW.period_id USING ERRCODE = '23503';
  END IF;
  IF NEW.entry_date < v_starts OR NEW.entry_date > v_ends THEN
    RAISE EXCEPTION 'entry_date % outside period range %..%', NEW.entry_date, v_starts, v_ends
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('posted', 'voided') AND v_period_status = 'closed' THEN
    IF current_setting('app.admin_override', true) <> 'on' THEN
      RAISE EXCEPTION 'cannot post into closed period %', NEW.period_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_check_period_open
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_check_period_open();

-- =====================================================================
-- 4) Polymorphic source_id sanity
-- =====================================================================
CREATE OR REPLACE FUNCTION je_check_source()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_type = 'reversal' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM journal_entries WHERE id = NEW.source_id
    ) THEN
      RAISE EXCEPTION 'reversal entry must reference an existing journal_entries row in source_id'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.reversed_entry_id IS NULL OR NEW.reversed_entry_id <> NEW.source_id THEN
      RAISE EXCEPTION 'reversal entry: reversed_entry_id must equal source_id'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.source_type = 'manual' AND NEW.source_id IS NOT NULL THEN
    RAISE EXCEPTION 'manual entry must not have source_id'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_check_source
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_check_source();
