-- Demo Accounts Payable: posted bills (+lines +JE), bill payments (+applications
-- +JE, some bills marked paid), vendor credits (+JE) and expense transactions
-- (+JE). Same draft -> post JE -> flip-to-posted ordering as AR. Idempotent.
DO $$
DECLARE
  r record;
  v_user uuid;
  v_ap uuid; v_cash uuid; v_ccard uuid;
  v_vends uuid[];
  v_bill_ids uuid[];
  v_bill_totals numeric[];
  v_vend uuid;
  v_bill uuid; v_je uuid; v_bp uuid; v_vc uuid; v_exp uuid;
  v_amt numeric;
  v_date date;
  v_exp_codes text[] := ARRAY['5200','5300','5400','5500','5600','5700','5800','5900','5950'];
  v_exp_code text;
  v_pay_codes text[] := ARRAY['1020','1024'];
  v_pay_code text;
  v_methods text[] := ARRAY['check','ach','card','wire'];
  i int;
BEGIN
  SELECT id INTO v_user FROM users WHERE email = 'admin@example.com' LIMIT 1;

  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF EXISTS (SELECT 1 FROM bills WHERE business_id = r.id AND bill_number LIKE 'BILL-2%') THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_ap    FROM chart_of_accounts WHERE business_id = r.id AND code = '2010';
    SELECT id INTO v_cash  FROM chart_of_accounts WHERE business_id = r.id AND code = '1020';
    SELECT id INTO v_ccard FROM chart_of_accounts WHERE business_id = r.id AND code = '1024';
    SELECT array_agg(id ORDER BY created_at) INTO v_vends FROM vendors WHERE business_id = r.id;

    v_bill_ids := '{}';
    v_bill_totals := '{}';

    -- 12 posted bills.
    FOR i IN 1..12 LOOP
      v_vend := v_vends[1 + (i % array_length(v_vends, 1))];
      v_date := make_date(2026, 1 + (i % 6), 2 + (i * 2) % 25);
      v_amt := 180 + (i * 211) % 3600;
      v_exp_code := v_exp_codes[1 + (i % array_length(v_exp_codes, 1))];
      v_bill := gen_random_uuid();

      INSERT INTO bills (id, business_id, vendor_id, bill_number, bill_date, due_date, status,
                         subtotal, total, ap_account_id, created_by_user_id, memo, terms)
      VALUES (v_bill, r.id, v_vend, 'BILL-' || (2000 + i), v_date, v_date + 30, 'draft',
              v_amt, v_amt, v_ap, v_user, 'Vendor bill', 'Net 30');

      INSERT INTO bill_lines (bill_id, line_number, description, quantity, unit_price,
                              expense_account_id, line_subtotal)
      VALUES (v_bill, 1, 'Goods / services', 1, v_amt,
              (SELECT id FROM chart_of_accounts WHERE business_id = r.id AND code = v_exp_code), v_amt);

      v_je := seed_post_je(r.id, v_date, 'Bill BILL-' || (2000 + i), 'bill', v_bill,
        jsonb_build_array(
          jsonb_build_object('code',v_exp_code,'debit',v_amt,'credit',0),
          jsonb_build_object('code','2010','debit',0,'credit',v_amt)));

      UPDATE bills SET status = 'posted', posted_journal_entry_id = v_je, posted_at = now(),
                       posted_by_user_id = v_user
        WHERE id = v_bill;

      v_bill_ids := array_append(v_bill_ids, v_bill);
      v_bill_totals := array_append(v_bill_totals, v_amt);
    END LOOP;

    -- Pay the first 7 bills in full; mark them paid.
    FOR i IN 1..7 LOOP
      v_bill := v_bill_ids[i];
      v_amt := v_bill_totals[i];
      v_vend := (SELECT vendor_id FROM bills WHERE id = v_bill);
      v_date := (SELECT bill_date FROM bills WHERE id = v_bill) + 22;
      v_bp := gen_random_uuid();

      INSERT INTO bill_payments (id, business_id, vendor_id, payment_date, payment_method, reference,
                                 amount, unapplied_amount, cash_account_id, status, created_by_user_id)
      VALUES (v_bp, r.id, v_vend, v_date, v_methods[1 + (i % 4)]::payment_method, 'CHK-' || (8000 + i),
              v_amt, 0, v_cash, 'draft', v_user);

      v_je := seed_post_je(r.id, v_date, 'Bill payment', 'bill_payment', v_bp,
        jsonb_build_array(
          jsonb_build_object('code','2010','debit',v_amt,'credit',0),
          jsonb_build_object('code','1020','debit',0,'credit',v_amt)));

      UPDATE bill_payments SET status = 'posted', posted_journal_entry_id = v_je, posted_at = now(),
                               posted_by_user_id = v_user
        WHERE id = v_bp;

      INSERT INTO bill_payment_applications (bill_payment_id, bill_id, applied_amount, applied_by_user_id)
      VALUES (v_bp, v_bill, v_amt, v_user);

      UPDATE bills SET status = 'paid' WHERE id = v_bill;
    END LOOP;

    -- Two posted vendor credits.
    FOR i IN 1..2 LOOP
      v_vend := v_vends[i];
      v_date := make_date(2026, 5, 6 + i);
      v_amt := 220 * i;
      v_exp_code := v_exp_codes[1 + (i % array_length(v_exp_codes, 1))];
      v_vc := gen_random_uuid();
      INSERT INTO vendor_credits (id, business_id, vendor_id, credit_date, amount, remaining_amount,
                                  offset_account_id, ap_account_id, status, created_by_user_id, memo)
      VALUES (v_vc, r.id, v_vend, v_date, v_amt, v_amt,
              (SELECT id FROM chart_of_accounts WHERE business_id = r.id AND code = v_exp_code),
              v_ap, 'draft', v_user, 'Vendor credit for returned goods');
      v_je := seed_post_je(r.id, v_date, 'Vendor credit', 'vendor_credit', v_vc,
        jsonb_build_array(
          jsonb_build_object('code','2010','debit',v_amt,'credit',0),
          jsonb_build_object('code',v_exp_code,'debit',0,'credit',v_amt)));
      UPDATE vendor_credits SET status = 'posted', posted_journal_entry_id = v_je, posted_at = now(),
                                posted_by_user_id = v_user
        WHERE id = v_vc;
    END LOOP;

    -- 10 posted expense transactions (quick spends, not via a bill).
    FOR i IN 1..10 LOOP
      v_vend := v_vends[1 + (i % array_length(v_vends, 1))];
      v_date := make_date(2026, 1 + (i % 6), 4 + (i * 2) % 22);
      v_amt := 35 + (i * 47) % 900;
      v_exp_code := v_exp_codes[1 + (i % array_length(v_exp_codes, 1))];
      v_pay_code := v_pay_codes[1 + (i % 2)];
      v_exp := gen_random_uuid();

      INSERT INTO expense_transactions (id, business_id, transaction_date, vendor_id, expense_account_id,
                                        payment_account_id, amount, memo, status, created_by_user_id)
      VALUES (v_exp, r.id, v_date, v_vend,
              (SELECT id FROM chart_of_accounts WHERE business_id = r.id AND code = v_exp_code),
              (SELECT id FROM chart_of_accounts WHERE business_id = r.id AND code = v_pay_code),
              v_amt, 'Operating expense', 'draft', v_user);

      v_je := seed_post_je(r.id, v_date, 'Expense', 'adjustment', NULL,
        jsonb_build_array(
          jsonb_build_object('code',v_exp_code,'debit',v_amt,'credit',0),
          jsonb_build_object('code',v_pay_code,'debit',0,'credit',v_amt)));

      UPDATE expense_transactions SET status = 'posted', journal_entry_id = v_je, posted_at = now(),
                                      posted_by_user_id = v_user
        WHERE id = v_exp;
    END LOOP;

  END LOOP;
END $$;
