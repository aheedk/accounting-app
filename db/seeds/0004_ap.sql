DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    -- Sample vendors (idempotent: skip if any exist)
    IF NOT EXISTS (SELECT 1 FROM vendors WHERE business_id = r.id) THEN
      INSERT INTO vendors (business_id, name, email, phone, default_terms_days, is_1099, tax_id) VALUES
        (r.id, 'Demo Vendor A', 'a@vendor.example.com', '555-0100', 30, false, NULL),
        (r.id, 'Demo Contractor B', 'b@contractor.example.com', '555-0101', 15, true, '12-3456789');
    END IF;
  END LOOP;
END $$;
