-- Idempotent-ish: run inside a transaction, skip if Acme firm exists.
DO $$
DECLARE
  v_firm_id uuid;
  v_biz_blue uuid;
  v_biz_green uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM firms WHERE name = 'Acme Accounting LLC') THEN
    RAISE NOTICE 'Seed already applied, skipping.';
    RETURN;
  END IF;

  INSERT INTO firms (name) VALUES ('Acme Accounting LLC') RETURNING id INTO v_firm_id;
  INSERT INTO businesses (firm_id, name, legal_name) VALUES
    (v_firm_id, 'Blue Widget Co.',  'Blue Widget Co., LLC')  RETURNING id INTO v_biz_blue;
  INSERT INTO businesses (firm_id, name, legal_name) VALUES
    (v_firm_id, 'Green Gadgets Inc.', 'Green Gadgets, Inc.') RETURNING id INTO v_biz_green;
END $$;
