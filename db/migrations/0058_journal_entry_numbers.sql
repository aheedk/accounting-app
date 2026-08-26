ALTER TABLE journal_entries
  ADD COLUMN journal_number text;

WITH numbered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY business_id
      ORDER BY entry_date, created_at, id
    )::text AS journal_number
  FROM journal_entries
)
UPDATE journal_entries AS je
SET journal_number = numbered.journal_number
FROM numbered
WHERE numbered.id = je.id;

ALTER TABLE journal_entries
  ALTER COLUMN journal_number SET NOT NULL,
  ADD CONSTRAINT journal_entries_number_not_blank
    CHECK (length(btrim(journal_number)) BETWEEN 1 AND 100);

CREATE UNIQUE INDEX uq_journal_entries_business_number
  ON journal_entries (business_id, journal_number)
  WHERE status <> 'voided';

INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'journal_entry', count(*)
FROM journal_entries
GROUP BY business_id
ON CONFLICT (business_id, entity_type) DO UPDATE
  SET last_value = GREATEST(numbering_counters.last_value, EXCLUDED.last_value);

CREATE OR REPLACE FUNCTION je_assign_journal_number()
RETURNS TRIGGER AS $$
DECLARE
  v_number bigint;
BEGIN
  IF NEW.journal_number IS NULL THEN
    INSERT INTO numbering_counters (business_id, entity_type, last_value)
    VALUES (NEW.business_id, 'journal_entry', 1)
    ON CONFLICT (business_id, entity_type) DO UPDATE
      SET last_value = numbering_counters.last_value + 1
    RETURNING last_value INTO v_number;
    NEW.journal_number := v_number::text;
  ELSIF NEW.journal_number ~ '^[1-9][0-9]{0,17}$' THEN
    INSERT INTO numbering_counters (business_id, entity_type, last_value)
    VALUES (NEW.business_id, 'journal_entry', NEW.journal_number::bigint)
    ON CONFLICT (business_id, entity_type) DO UPDATE
      SET last_value = GREATEST(numbering_counters.last_value, EXCLUDED.last_value);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_assign_journal_number
  BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_assign_journal_number();

CREATE OR REPLACE FUNCTION je_protect_journal_number()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('posted', 'voided')
     AND NEW.journal_number IS DISTINCT FROM OLD.journal_number THEN
    RAISE EXCEPTION 'cannot mutate journal number of posted journal entry %', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_protect_journal_number
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_protect_journal_number();
