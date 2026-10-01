-- Document numbers for credit memos and vendor credits, so reports have
-- something to show in the Num column (invoices and bills already do).
--
-- The posted-immutability triggers only guard amounts, parties, dates and
-- accounts, so backfilling a number onto posted rows is allowed.

ALTER TABLE credit_memos   ADD COLUMN IF NOT EXISTS credit_memo_number   text;
ALTER TABLE vendor_credits ADD COLUMN IF NOT EXISTS vendor_credit_number text;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY business_id ORDER BY created_at, id) AS n
  FROM credit_memos WHERE credit_memo_number IS NULL
)
UPDATE credit_memos c SET credit_memo_number = 'CM-' || (1000 + numbered.n)
FROM numbered WHERE numbered.id = c.id;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY business_id ORDER BY created_at, id) AS n
  FROM vendor_credits WHERE vendor_credit_number IS NULL
)
UPDATE vendor_credits v SET vendor_credit_number = 'VC-' || (1000 + numbered.n)
FROM numbered WHERE numbered.id = v.id;

-- New documents continue the sequence from the per-business counters.
INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'credit_memo', count(*) FROM credit_memos GROUP BY business_id
ON CONFLICT (business_id, entity_type)
  DO UPDATE SET last_value = GREATEST(numbering_counters.last_value, EXCLUDED.last_value);

INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'vendor_credit', count(*) FROM vendor_credits GROUP BY business_id
ON CONFLICT (business_id, entity_type)
  DO UPDATE SET last_value = GREATEST(numbering_counters.last_value, EXCLUDED.last_value);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_memos_number
  ON credit_memos (business_id, credit_memo_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_credits_number
  ON vendor_credits (business_id, vendor_credit_number);
