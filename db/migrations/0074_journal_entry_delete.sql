-- =====================================================================
-- Deleting journal entries (QBO parity).
--
-- Posted rows still cannot be deleted by default. The controlled delete path
-- (ledgerService.deleteJournalEntry) sets app.allow_delete = 'on' for one
-- transaction, mirroring app.allow_void and app.allow_edit. That path only
-- accepts standalone manual / adjusting entries (and a voided entry together
-- with its reversal), in open periods, and writes the removed rows to the
-- audit log.
--
-- Lines go with their entry through the existing ON DELETE CASCADE; the line
-- trigger looks the parent up, finds it already gone, and lets them through.
-- =====================================================================

CREATE OR REPLACE FUNCTION je_protect_posted_row()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted'
       AND COALESCE(current_setting('app.allow_delete', true), '') <> 'on' THEN
      RAISE EXCEPTION 'cannot delete posted journal entry % outside controlled delete path', OLD.id
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
