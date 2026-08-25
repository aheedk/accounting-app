ALTER TABLE journal_entries
  ADD COLUMN corrected_from_entry_id uuid NULL REFERENCES journal_entries(id);

CREATE UNIQUE INDEX uq_journal_entries_corrected_from
  ON journal_entries(corrected_from_entry_id)
  WHERE corrected_from_entry_id IS NOT NULL;

ALTER TABLE journal_entry_lines
  ADD COLUMN name text NULL,
  ADD COLUMN class_name text NULL,
  ADD CONSTRAINT journal_entry_lines_name_length
    CHECK (name IS NULL OR char_length(name) <= 255),
  ADD CONSTRAINT journal_entry_lines_class_name_length
    CHECK (class_name IS NULL OR char_length(class_name) <= 255);

-- A correction is a new manual/adjustment entry linked to one voided original
-- from the same business. The application still owns the atomic reversal and
-- replacement workflow; this trigger protects the relationship from direct SQL.
CREATE OR REPLACE FUNCTION je_check_correction_link()
RETURNS TRIGGER AS $$
DECLARE
  v_original journal_entries%ROWTYPE;
BEGIN
  IF NEW.corrected_from_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type NOT IN ('manual', 'adjustment') THEN
    RAISE EXCEPTION 'corrected journal entry % must be manual or adjustment', NEW.id
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_original
    FROM journal_entries
    WHERE id = NEW.corrected_from_entry_id;

  IF NOT FOUND OR v_original.business_id <> NEW.business_id THEN
    RAISE EXCEPTION 'corrected journal entry must reference an original in the same business'
      USING ERRCODE = '23514';
  END IF;

  IF v_original.status <> 'voided' OR v_original.source_type NOT IN ('manual', 'adjustment') THEN
    RAISE EXCEPTION 'corrected journal entry must reference a voided manual or adjustment entry'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_check_correction_link
  BEFORE INSERT OR UPDATE OF corrected_from_entry_id ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_check_correction_link();

-- Include the new linkage in the posted-row immutability comparison.
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
