DO $$
DECLARE
  r record;
  v_cash uuid;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM bank_accounts WHERE business_id = r.id) THEN
      SELECT id INTO v_cash FROM chart_of_accounts WHERE business_id = r.id AND code = '1020';
      IF v_cash IS NOT NULL THEN
        INSERT INTO bank_accounts (business_id, name, institution, account_last_four, cash_account_id)
        VALUES (r.id, 'Primary Checking', 'Demo Bank', '4321', v_cash);
      END IF;
    END IF;
  END LOOP;
END $$;
