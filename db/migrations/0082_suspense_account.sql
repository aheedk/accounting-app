-- Suspense: where the AI parks lines it cannot code, until someone reclassifies them.
-- Spec: docs/specs/2026-10-04-suspense-account-design.md

-- One Suspense account per business, found by detail_type. 1999, or the first
-- free 199x code when 1999 is already used.
DO $$
DECLARE
  biz record;
  free_code text;
BEGIN
  FOR biz IN
    SELECT b.id FROM businesses b
    WHERE NOT EXISTS (
      SELECT 1 FROM chart_of_accounts c WHERE c.business_id = b.id AND c.detail_type = 'Suspense'
    )
  LOOP
    SELECT code INTO free_code
    FROM (SELECT (1999 - n)::text AS code FROM generate_series(0, 9) AS n) candidates
    WHERE NOT EXISTS (
      SELECT 1 FROM chart_of_accounts c WHERE c.business_id = biz.id AND c.code = candidates.code
    )
    ORDER BY code DESC
    LIMIT 1;
    IF free_code IS NOT NULL THEN
      INSERT INTO chart_of_accounts (business_id, code, name, account_type, detail_type, is_system, description)
      VALUES (biz.id, free_code, 'Suspense', 'asset', 'Suspense', true,
              'Transactions waiting to be categorized. Should be zero before a period is closed.');
    END IF;
  END LOOP;
END $$;

-- How each Suspense item was cleared.
CREATE TABLE IF NOT EXISTS suspense_reclassifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  -- The entry that carried the Suspense line (as it was before any edit).
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  -- 'edited': the source transaction was changed in place.
  -- 'journal_entry': a reclassification entry moved the amount.
  method text NOT NULL CHECK (method IN ('edited', 'journal_entry')),
  -- The entry after the change (the reposted entry, or the reclassification entry).
  result_journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  to_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suspense_reclass_business ON suspense_reclassifications (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suspense_reclass_entry ON suspense_reclassifications (journal_entry_id);
