-- System accounts get a fixed key, so the app finds them by what they are
-- rather than by their number, and every account number becomes editable.
-- Spec: docs/specs/2026-07-20-chart-of-accounts-design.md ("Editing an account")

ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS system_key text;

-- What each default system account is (codes as seeded by seed_default_coa).
CREATE OR REPLACE FUNCTION coa_default_system_key(p_code text, p_detail_type text)
RETURNS text AS $$
  SELECT CASE
    WHEN p_detail_type = 'Suspense' THEN 'suspense'
    WHEN p_code = '1010' THEN 'cash_on_hand'
    WHEN p_code = '1020' THEN 'operating_bank'
    WHEN p_code = '1100' THEN 'accounts_receivable'
    WHEN p_code = '2010' THEN 'accounts_payable'
    WHEN p_code = '2100' THEN 'sales_tax_payable'
    WHEN p_code = '3020' THEN 'retained_earnings'
  END;
$$ LANGUAGE sql IMMUTABLE;

UPDATE chart_of_accounts
SET system_key = coa_default_system_key(code, detail_type)
WHERE is_system AND system_key IS NULL;

-- A system account created later (new business, Suspense) is keyed as it is inserted.
CREATE OR REPLACE FUNCTION coa_assign_system_key() RETURNS trigger AS $$
BEGIN
  IF NEW.is_system AND NEW.system_key IS NULL THEN
    NEW.system_key := coa_default_system_key(NEW.code, NEW.detail_type);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coa_assign_system_key ON chart_of_accounts;
CREATE TRIGGER coa_assign_system_key
  BEFORE INSERT ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION coa_assign_system_key();

CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_business_system_key
  ON chart_of_accounts (business_id, system_key) WHERE system_key IS NOT NULL;
