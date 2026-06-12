-- Add additional bank accounts for each business (idempotent by name)
DO $$
DECLARE
  r record;
  v_coa_savings uuid;
  v_coa_payroll uuid;
  v_coa_money_market uuid;
  v_coa_credit_card uuid;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP

    -- Ensure backing COA accounts exist
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = r.id AND code = '1021') THEN
      INSERT INTO chart_of_accounts (business_id, code, name, account_type, is_system, is_active)
      VALUES (r.id, '1021', 'Business Savings Account', 'asset', false, true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = r.id AND code = '1022') THEN
      INSERT INTO chart_of_accounts (business_id, code, name, account_type, is_system, is_active)
      VALUES (r.id, '1022', 'Payroll Checking Account', 'asset', false, true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = r.id AND code = '1023') THEN
      INSERT INTO chart_of_accounts (business_id, code, name, account_type, is_system, is_active)
      VALUES (r.id, '1023', 'Money Market Account', 'asset', false, true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = r.id AND code = '1024') THEN
      INSERT INTO chart_of_accounts (business_id, code, name, account_type, is_system, is_active)
      VALUES (r.id, '1024', 'Business Credit Card Clearing', 'asset', false, true);
    END IF;

    -- Savings account
    SELECT id INTO v_coa_savings FROM chart_of_accounts WHERE business_id = r.id AND code = '1021';
    IF v_coa_savings IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bank_accounts WHERE business_id = r.id AND name = 'Business Savings'
    ) THEN
      INSERT INTO bank_accounts (business_id, name, institution, account_last_four, cash_account_id)
      VALUES (r.id, 'Business Savings', 'Demo Bank', '8823', v_coa_savings);
    END IF;

    -- Payroll checking
    SELECT id INTO v_coa_payroll FROM chart_of_accounts WHERE business_id = r.id AND code = '1022';
    IF v_coa_payroll IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bank_accounts WHERE business_id = r.id AND name = 'Payroll Checking'
    ) THEN
      INSERT INTO bank_accounts (business_id, name, institution, account_last_four, cash_account_id)
      VALUES (r.id, 'Payroll Checking', 'Demo Bank', '5512', v_coa_payroll);
    END IF;

    -- Money market
    SELECT id INTO v_coa_money_market FROM chart_of_accounts WHERE business_id = r.id AND code = '1023';
    IF v_coa_money_market IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bank_accounts WHERE business_id = r.id AND name = 'Money Market'
    ) THEN
      INSERT INTO bank_accounts (business_id, name, institution, account_last_four, cash_account_id)
      VALUES (r.id, 'Money Market', 'First National', '3301', v_coa_money_market);
    END IF;

    -- Credit card clearing
    SELECT id INTO v_coa_credit_card FROM chart_of_accounts WHERE business_id = r.id AND code = '1024';
    IF v_coa_credit_card IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bank_accounts WHERE business_id = r.id AND name = 'Business Credit Card'
    ) THEN
      INSERT INTO bank_accounts (business_id, name, institution, account_last_four, cash_account_id)
      VALUES (r.id, 'Business Credit Card', 'Chase', '9947', v_coa_credit_card);
    END IF;

  END LOOP;
END $$;
