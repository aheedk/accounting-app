-- =====================================================================
-- In-place editing of posted manual journal entries (QBO parity).
--
-- Posted rows stay immutable by default. A controlled edit path may set
-- app.allow_edit = 'on' for the duration of one transaction, mirroring the
-- existing app.allow_void escape hatch used by the void path.
--
-- Even under app.allow_edit the ledger identity of the row is frozen: the
-- entry cannot change business, change status, change its source linkage,
-- or acquire/lose reversal and correction links. Only the accounting
-- content a user edits in the journal grid may move -- date, period, memo,
-- reference, journal number, and lines.
--
-- Line edits are re-validated by the existing deferred balance constraint
-- trigger (trg_jel_balance_*), so an unbalanced in-place edit still aborts
-- at COMMIT.
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

  IF OLD.status = 'posted' THEN
    IF NEW.status = 'voided' THEN
      IF COALESCE(current_setting('app.allow_void', true), '') <> 'on' THEN
        RAISE EXCEPTION 'cannot void posted JE % outside controlled void path', OLD.id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;

    IF COALESCE(current_setting('app.allow_edit', true), '') = 'on' THEN
      -- Editable content may move; ledger identity may not.
      IF (NEW.status, NEW.source_type, NEW.source_id, NEW.reversed_entry_id, NEW.corrected_from_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.source_type, OLD.source_id, OLD.reversed_entry_id, OLD.corrected_from_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot change identity of posted journal entry % during an in-place edit', OLD.id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;

    IF (NEW.status, NEW.entry_date, NEW.memo, NEW.reference, NEW.source_type, NEW.source_id, NEW.reversed_entry_id, NEW.corrected_from_entry_id, NEW.business_id, NEW.period_id)
       IS DISTINCT FROM
       (OLD.status, OLD.entry_date, OLD.memo, OLD.reference, OLD.source_type, OLD.source_id, OLD.reversed_entry_id, OLD.corrected_from_entry_id, OLD.business_id, OLD.period_id) THEN
      RAISE EXCEPTION 'cannot mutate posted journal entry % (only void path is allowed)', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION jel_protect_posted_row()
RETURNS TRIGGER AS $$
DECLARE
  v_status journal_entry_status;
  v_je_id uuid;
BEGIN
  v_je_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT status INTO v_status FROM journal_entries WHERE id = v_je_id;
  IF v_status = 'posted'
     AND COALESCE(current_setting('app.allow_void', true), '') <> 'on'
     AND COALESCE(current_setting('app.allow_edit', true), '') <> 'on' THEN
    RAISE EXCEPTION 'cannot mutate lines of posted journal entry %', v_je_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
