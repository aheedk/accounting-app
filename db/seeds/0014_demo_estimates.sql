-- Demo estimates (item 17): five quotes per business, one in each state an
-- estimate can sit in before it becomes an invoice — pending, pending past its
-- expiration date (shows as Expired), accepted, rejected, and pending with no
-- expiration date. Nothing here is in the ledger. Idempotent per business.
-- Spec: docs/specs/2026-10-20-estimates-design.md
DO $$
DECLARE
  r record;
  it record;
  v_user uuid;
  v_rev uuid; v_ca_tax uuid; v_rate numeric;
  v_custs uuid[];
  v_items uuid[];
  v_est uuid; v_status text; v_date date; v_exp date; v_taxed boolean;
  v_desc text; v_price numeric; v_acct uuid; v_item_id uuid;
  v_qty numeric; v_sub numeric; v_tax numeric; v_tot_sub numeric; v_tot_tax numeric;
  i int; j int;
BEGIN
  SELECT id INTO v_user FROM users WHERE email = 'admin@example.com' LIMIT 1;

  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF EXISTS (SELECT 1 FROM estimates WHERE business_id = r.id) THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_rev FROM chart_of_accounts WHERE business_id = r.id AND code = '4010';
    SELECT id INTO v_ca_tax FROM tax_codes WHERE business_id = r.id AND code = 'CA';
    SELECT rate INTO v_rate FROM tax_rates WHERE tax_code_id = v_ca_tax ORDER BY effective_from DESC LIMIT 1;
    SELECT array_agg(id ORDER BY created_at) INTO v_custs FROM customers WHERE business_id = r.id AND deleted_at IS NULL;
    SELECT array_agg(id ORDER BY sku) INTO v_items FROM inventory_items WHERE business_id = r.id;
    IF v_rev IS NULL OR v_custs IS NULL THEN
      CONTINUE;
    END IF;

    FOR i IN 1..5 LOOP
      v_status := (ARRAY['pending', 'pending', 'accepted', 'rejected', 'pending'])[i];
      v_date := CASE WHEN i = 2 THEN current_date - 60 ELSE current_date - i * 4 END;
      v_exp := CASE WHEN i = 2 THEN current_date - 30 WHEN i = 5 THEN NULL ELSE v_date + 30 END;
      v_taxed := v_ca_tax IS NOT NULL AND v_rate IS NOT NULL AND i % 2 = 1;
      v_est := gen_random_uuid();

      INSERT INTO estimates (id, business_id, estimate_number, customer_id, estimate_date, expiration_date,
                             status, memo, accepted_by, accepted_date, created_by_user_id)
      VALUES (v_est, r.id, 'EST-' || lpad(i::text, 4, '0'), v_custs[1 + (i % array_length(v_custs, 1))],
              v_date, v_exp, v_status::estimate_status, 'Thank you for the opportunity to quote.',
              CASE WHEN v_status = 'accepted' THEN 'Dana Ruiz' END,
              CASE WHEN v_status = 'accepted' THEN v_date + 2 END, v_user);

      v_tot_sub := 0;
      v_tot_tax := 0;
      FOR j IN 1..2 LOOP
        v_item_id := NULL;
        v_desc := CASE WHEN j = 1 THEN 'Equipment' ELSE 'Installation and training' END;
        v_price := CASE WHEN j = 1 THEN 1200 + i * 150 ELSE 450 END;
        v_acct := v_rev;
        IF v_items IS NOT NULL THEN
          SELECT id, name, sale_price, income_account_id INTO it
            FROM inventory_items WHERE id = v_items[1 + ((i * 2 + j) % array_length(v_items, 1))];
          IF it.income_account_id IS NOT NULL THEN
            v_item_id := it.id;
            v_desc := it.name;
            v_price := COALESCE(it.sale_price, v_price);
            v_acct := it.income_account_id;
          END IF;
        END IF;
        v_qty := j + (i % 3);
        v_sub := round(v_qty * v_price, 4);
        v_tax := CASE WHEN v_taxed THEN round(v_sub * v_rate, 4) ELSE 0 END;
        INSERT INTO estimate_lines (estimate_id, line_number, inventory_item_id, description, quantity, unit_price,
                                    revenue_account_id, tax_code_id, line_subtotal, tax_amount, line_total)
        VALUES (v_est, j, v_item_id, v_desc, v_qty, v_price, v_acct,
                CASE WHEN v_taxed THEN v_ca_tax END, v_sub, v_tax, v_sub + v_tax);
        v_tot_sub := v_tot_sub + v_sub;
        v_tot_tax := v_tot_tax + v_tax;
      END LOOP;

      UPDATE estimates SET subtotal = v_tot_sub, tax_total = v_tot_tax, total = v_tot_sub + v_tot_tax
        WHERE id = v_est;
    END LOOP;

    -- The next estimate made in the app follows on from these.
    INSERT INTO numbering_counters (business_id, entity_type, last_value)
    VALUES (r.id, 'estimate', 5)
    ON CONFLICT (business_id, entity_type)
      DO UPDATE SET last_value = GREATEST(numbering_counters.last_value, 5);
  END LOOP;
END $$;
