DO $$
DECLARE
  r record;
  v_tax_acct uuid;
  v_tax_code_id uuid;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    -- Sample customers (idempotent: skip if any exist)
    IF NOT EXISTS (SELECT 1 FROM customers WHERE business_id = r.id) THEN
      INSERT INTO customers (business_id, name, email, default_terms_days) VALUES
        (r.id, 'Demo Customer A', 'a@demo.example.com', 30),
        (r.id, 'Demo Customer B', 'b@demo.example.com', 15);
    END IF;
    -- Sample tax code (CA Sales Tax 8.75%) tied to system Sales Tax Payable
    SELECT id INTO v_tax_acct FROM chart_of_accounts WHERE business_id = r.id AND code = '2100';
    IF v_tax_acct IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_codes WHERE business_id = r.id) THEN
      INSERT INTO tax_codes (business_id, code, name, tax_payable_account_id)
        VALUES (r.id, 'CA', 'CA Sales Tax 8.75%', v_tax_acct)
        RETURNING id INTO v_tax_code_id;
      INSERT INTO tax_rates (tax_code_id, rate, effective_from)
        VALUES (v_tax_code_id, 0.0875, '2000-01-01');
    END IF;
  END LOOP;
END $$;
