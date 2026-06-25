-- Demo banking + the remaining sections: bank transactions, bank rules, a
-- reconciliation, integration inbox, fixed assets with depreciation (+JE),
-- standalone manual journal entries, files/receipts and saved custom reports.
-- Idempotent per business.
DO $$
DECLARE
  r record;
  v_user uuid;
  a_equip uuid; a_accdep uuid; a_depexp uuid; a_cash uuid; a_owner uuid; a_draws uuid;
  v_banks uuid[]; v_primary uuid; v_ba uuid;
  v_fa uuid; v_je uuid; v_file uuid; v_bill uuid; v_exp uuid;
  v_assets text[][] := ARRAY[
    ARRAY['Delivery Van','28000','2800','5'],
    ARRAY['Office Furniture','6000','600','7'],
    ARRAY['Laptop Fleet','9000','0','3']
  ];
  v_name text; v_cost numeric; v_salvage numeric; v_life int; v_dep numeric; v_pend date;
  i int; j int; m int;
BEGIN
  SELECT id INTO v_user FROM users WHERE email = 'admin@example.com' LIMIT 1;

  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF EXISTS (SELECT 1 FROM bank_transactions WHERE business_id = r.id) THEN
      CONTINUE;
    END IF;

    SELECT id INTO a_equip  FROM chart_of_accounts WHERE business_id = r.id AND code = '1500';
    SELECT id INTO a_accdep FROM chart_of_accounts WHERE business_id = r.id AND code = '1510';
    SELECT id INTO a_depexp FROM chart_of_accounts WHERE business_id = r.id AND code = '5910';
    SELECT id INTO a_cash   FROM chart_of_accounts WHERE business_id = r.id AND code = '1020';
    SELECT id INTO a_owner  FROM chart_of_accounts WHERE business_id = r.id AND code = '3010';
    SELECT id INTO a_draws  FROM chart_of_accounts WHERE business_id = r.id AND code = '3030';
    SELECT array_agg(id ORDER BY created_at) INTO v_banks FROM bank_accounts WHERE business_id = r.id;
    SELECT id INTO v_primary FROM bank_accounts WHERE business_id = r.id AND name = 'Primary Checking';

    -- Imported bank transactions (unreviewed inbox, plus one excluded). Matched
    -- and categorized states require a linked JE, so we leave those to the app.
    FOREACH v_ba IN ARRAY v_banks LOOP
      FOR i IN 1..6 LOOP
        INSERT INTO bank_transactions (business_id, bank_account_id, transaction_date, description, amount,
                                       external_id, status, excluded_reason, reviewed_at, reviewed_by_user_id)
        VALUES (
          r.id, v_ba, make_date(2026, 1 + (i % 6), 2 + (i * 4) % 25),
          (ARRAY['ACH Deposit - Customer','Card Purchase - Supplies','Wire In - Sales','POS - Fuel',
                 'Transfer - Payroll','Service Fee'])[i],
          (ARRAY[1850.00, -240.50, 5200.00, -88.25, -4200.00, -35.00])[i],
          'EXT-' || substr(v_ba::text, 1, 8) || '-' || i,
          (CASE WHEN i = 6 THEN 'excluded' ELSE 'unreviewed' END)::bank_transaction_status,
          (CASE WHEN i = 6 THEN 'Personal / non-business' ELSE NULL END),
          (CASE WHEN i = 6 THEN now() ELSE NULL END),
          (CASE WHEN i = 6 THEN v_user ELSE NULL END)
        );
      END LOOP;
    END LOOP;

    -- Bank rules.
    INSERT INTO bank_transaction_rules (business_id, name, description_contains, offset_account_id, sign_filter, priority)
    VALUES
      (r.id, 'Stripe payouts → Sales',  'Stripe',  (SELECT id FROM chart_of_accounts WHERE business_id=r.id AND code='4010'), 'inflow_only', 10),
      (r.id, 'Cloud bills → Software',  'AWS',     (SELECT id FROM chart_of_accounts WHERE business_id=r.id AND code='5500'), 'outflow_only', 20),
      (r.id, 'Rent → Rent expense',     'Rent',    (SELECT id FROM chart_of_accounts WHERE business_id=r.id AND code='5200'), 'outflow_only', 30);

    -- One completed reconciliation on the primary account.
    IF v_primary IS NOT NULL THEN
      INSERT INTO bank_reconciliations (business_id, bank_account_id, period_start, period_end, statement_ending_balance, reconciled_by_user_id, memo)
      VALUES (r.id, v_primary, '2026-04-01', '2026-04-30', 18450.00, v_user, 'April statement reconciled');
    END IF;

    -- Integration inbox (pending imported activity).
    INSERT INTO integration_inbox (business_id, source, external_id, occurred_at, description, amount, raw_payload, status)
    VALUES
      (r.id, 'stripe_csv',  'ch_1001', '2026-06-01', 'Stripe charge - order 1001', 120.00, jsonb_build_object('id','ch_1001','net',116.5), 'pending'),
      (r.id, 'stripe_csv',  'ch_1002', '2026-06-03', 'Stripe charge - order 1002', 89.99,  jsonb_build_object('id','ch_1002','net',86.9),  'pending'),
      (r.id, 'paypal_csv',  'pp_2001', '2026-06-04', 'PayPal payment received',     54.25,  jsonb_build_object('id','pp_2001'),             'pending'),
      (r.id, 'shopify_csv', 'sh_3001', '2026-06-05', 'Shopify order #3001',         210.00, jsonb_build_object('id','sh_3001','items',3),    'pending'),
      (r.id, 'generic',     NULL,      '2026-06-06', 'Misc imported deposit',        75.00,  jsonb_build_object('memo','manual import'),     'pending');

    -- Fixed assets + monthly depreciation (each depreciation posts a JE).
    FOR j IN 1..array_length(v_assets, 1) LOOP
      v_name    := v_assets[j][1];
      v_cost    := v_assets[j][2]::numeric;
      v_salvage := v_assets[j][3]::numeric;
      v_life    := v_assets[j][4]::int;
      v_fa := gen_random_uuid();

      -- Purchase (DR equipment / CR cash) so the balance sheet carries the cost.
      v_je := seed_post_je(r.id, '2026-01-10', 'Asset purchase: ' || v_name, 'adjustment', NULL,
        jsonb_build_array(
          jsonb_build_object('code','1500','debit',v_cost,'credit',0),
          jsonb_build_object('code','1020','debit',0,'credit',v_cost)));

      INSERT INTO fixed_assets (id, business_id, name, asset_account_id, depreciation_expense_account_id,
                                accumulated_depreciation_account_id, purchase_date, cost, salvage_value,
                                useful_life_years, status, memo)
      VALUES (v_fa, r.id, v_name, a_equip, a_depexp, a_accdep, '2026-01-10', v_cost, v_salvage, v_life,
              'active', 'Straight-line depreciation');

      v_dep := round((v_cost - v_salvage) / v_life / 12.0, 2);
      FOR m IN 2..4 LOOP
        v_pend := (make_date(2026, m, 1) + interval '1 month' - interval '1 day')::date;
        v_je := seed_post_je(r.id, v_pend, 'Depreciation: ' || v_name, 'adjustment', NULL,
          jsonb_build_array(
            jsonb_build_object('code','5910','debit',v_dep,'credit',0),
            jsonb_build_object('code','1510','debit',0,'credit',v_dep)));
        INSERT INTO depreciation_entries (fixed_asset_id, period_end, amount, journal_entry_id, posted_by_user_id)
        VALUES (v_fa, v_pend, v_dep, v_je, v_user);
      END LOOP;
    END LOOP;

    -- Standalone manual journal entries.
    PERFORM seed_post_je(r.id, '2026-01-02', 'Owner capital contribution', 'manual', NULL,
      jsonb_build_array(
        jsonb_build_object('code','1020','debit',50000,'credit',0),
        jsonb_build_object('code','3010','debit',0,'credit',50000)));
    PERFORM seed_post_je(r.id, '2026-03-20', 'Owner draw', 'manual', NULL,
      jsonb_build_array(
        jsonb_build_object('code','3030','debit',2000,'credit',0),
        jsonb_build_object('code','1020','debit',0,'credit',2000)));
    PERFORM seed_post_je(r.id, '2026-05-31', 'Bank service charge adjustment', 'manual', NULL,
      jsonb_build_array(
        jsonb_build_object('code','5600','debit',45,'credit',0),
        jsonb_build_object('code','1020','debit',0,'credit',45)));

    -- Files + receipts (list-only; no bytes are stored on disk for the demo).
    SELECT id INTO v_bill FROM bills WHERE business_id = r.id ORDER BY bill_number LIMIT 1;
    SELECT id INTO v_exp  FROM expense_transactions WHERE business_id = r.id ORDER BY created_at LIMIT 1;
    FOR i IN 1..3 LOOP
      v_file := gen_random_uuid();
      INSERT INTO files (id, business_id, original_name, mime_type, byte_size, storage_path, uploaded_by_user_id)
      VALUES (v_file, r.id, 'receipt-' || i || '.pdf', 'application/pdf', 20480 + i * 1024,
              'demo/receipts/receipt-' || i || '.pdf', v_user);
      INSERT INTO receipts (business_id, file_id, uploaded_by_user_id, linked_entity_type, linked_entity_id)
      VALUES (
        r.id, v_file, v_user,
        (CASE i WHEN 1 THEN 'bill' WHEN 2 THEN 'expense_transaction' ELSE 'unlinked' END)::receipt_linked_entity_type,
        (CASE i WHEN 1 THEN v_bill WHEN 2 THEN v_exp ELSE NULL END)
      );
    END LOOP;

    -- Saved custom reports.
    INSERT INTO custom_report_definitions (business_id, name, owner_user_id, definition)
    VALUES
      (r.id, 'Net activity by month', v_user, jsonb_build_object(
        'account_ids', jsonb_build_array(),
        'date_range', jsonb_build_object('from','2026-01-01','to','2026-12-31'),
        'group_by', 'month', 'columns', jsonb_build_array('net'))),
      (r.id, 'Debit/credit by account', v_user, jsonb_build_object(
        'account_ids', jsonb_build_array(),
        'date_range', jsonb_build_object('from','2026-01-01','to','2026-12-31'),
        'group_by', 'account', 'columns', jsonb_build_array('debit','credit','net')));

  END LOOP;
END $$;
