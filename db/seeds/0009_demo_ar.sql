-- Demo Accounts Receivable: posted invoices (+lines +balanced JE), customer
-- payments (+applications +JE, some invoices marked paid) and credit memos.
-- Ledger-bearing rows are inserted as draft, then a JE is posted referencing
-- them, then they are flipped to posted (source-integrity triggers require the
-- entity row to exist before its JE). Idempotent per business.
DO $$
DECLARE
  r record;
  v_user uuid;
  v_ar uuid; v_cash uuid; v_returns uuid; v_rev_sales uuid; v_rev_svc uuid;
  v_ca_tax uuid;
  v_custs uuid[];
  v_inv_ids uuid[];
  v_inv_totals numeric[];
  v_cust uuid;
  v_inv uuid; v_je uuid; v_pay uuid; v_cm uuid;
  v_sub numeric; v_tax numeric; v_total numeric;
  v_date date; v_taxable boolean; v_is_svc boolean; v_rev_code text;
  v_methods text[] := ARRAY['check','ach','card','wire'];
  i int;
BEGIN
  SELECT id INTO v_user FROM users WHERE email = 'admin@example.com' LIMIT 1;

  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF EXISTS (SELECT 1 FROM invoices WHERE business_id = r.id AND invoice_number LIKE 'INV-1%') THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_ar        FROM chart_of_accounts WHERE business_id = r.id AND code = '1100';
    SELECT id INTO v_cash      FROM chart_of_accounts WHERE business_id = r.id AND code = '1020';
    SELECT id INTO v_rev_sales FROM chart_of_accounts WHERE business_id = r.id AND code = '4010';
    SELECT id INTO v_rev_svc   FROM chart_of_accounts WHERE business_id = r.id AND code = '4020';
    SELECT id INTO v_returns   FROM chart_of_accounts WHERE business_id = r.id AND code = '4910';
    SELECT id INTO v_ca_tax    FROM tax_codes WHERE business_id = r.id AND code = 'CA';
    SELECT array_agg(id ORDER BY created_at) INTO v_custs FROM customers WHERE business_id = r.id;

    v_inv_ids := '{}';
    v_inv_totals := '{}';

    -- 14 posted invoices across the first half of the year.
    FOR i IN 1..14 LOOP
      v_cust := v_custs[1 + (i % array_length(v_custs, 1))];
      v_date := make_date(2026, 1 + (i % 6), 1 + (i * 3) % 26);
      v_sub := 2500 + (i * 911) % 7500;
      v_taxable := (i % 2 = 0);
      v_is_svc := (i % 3 = 0);
      v_rev_code := CASE WHEN v_is_svc THEN '4020' ELSE '4010' END;
      v_tax := CASE WHEN v_taxable THEN round(v_sub * 0.0875, 2) ELSE 0 END;
      v_total := v_sub + v_tax;
      v_inv := gen_random_uuid();

      INSERT INTO invoices (id, business_id, customer_id, invoice_number, issue_date, due_date, status,
                            subtotal, tax_total, total, ar_account_id, created_by_user_id, memo)
      VALUES (v_inv, r.id, v_cust, 'INV-' || (1000 + i), v_date, v_date + 30, 'draft',
              v_sub, v_tax, v_total, v_ar, v_user, 'Services and goods rendered');

      INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit_price,
                                 revenue_account_id, tax_code_id, line_subtotal, tax_amount, line_total)
      VALUES (v_inv, 1,
              CASE WHEN v_is_svc THEN 'Professional services' ELSE 'Product sale' END,
              1, v_sub, CASE WHEN v_is_svc THEN v_rev_svc ELSE v_rev_sales END,
              CASE WHEN v_taxable THEN v_ca_tax ELSE NULL END, v_sub, v_tax, v_total);

      v_je := seed_post_je(r.id, v_date, 'Invoice INV-' || (1000 + i), 'invoice', v_inv,
        CASE WHEN v_taxable THEN
          jsonb_build_array(
            jsonb_build_object('code','1100','debit',v_total,'credit',0),
            jsonb_build_object('code',v_rev_code,'debit',0,'credit',v_sub),
            jsonb_build_object('code','2100','debit',0,'credit',v_tax))
        ELSE
          jsonb_build_array(
            jsonb_build_object('code','1100','debit',v_total,'credit',0),
            jsonb_build_object('code',v_rev_code,'debit',0,'credit',v_sub))
        END);

      UPDATE invoices SET status = 'posted', posted_journal_entry_id = v_je, posted_at = now(),
                          posted_by_user_id = v_user
        WHERE id = v_inv;

      v_inv_ids := array_append(v_inv_ids, v_inv);
      v_inv_totals := array_append(v_inv_totals, v_total);
    END LOOP;

    -- Pay the first 8 invoices in full; mark them paid.
    FOR i IN 1..8 LOOP
      v_inv := v_inv_ids[i];
      v_total := v_inv_totals[i];
      v_cust := (SELECT customer_id FROM invoices WHERE id = v_inv);
      v_date := (SELECT issue_date FROM invoices WHERE id = v_inv) + 18;
      v_pay := gen_random_uuid();

      INSERT INTO payments (id, business_id, customer_id, payment_date, payment_method, reference,
                            amount, unapplied_amount, cash_account_id, status, created_by_user_id)
      VALUES (v_pay, r.id, v_cust, v_date, v_methods[1 + (i % 4)]::payment_method, 'RCPT-' || (5000 + i),
              v_total, 0, v_cash, 'draft', v_user);

      v_je := seed_post_je(r.id, v_date, 'Payment received', 'payment', v_pay,
        jsonb_build_array(
          jsonb_build_object('code','1020','debit',v_total,'credit',0),
          jsonb_build_object('code','1100','debit',0,'credit',v_total)));

      UPDATE payments SET status = 'posted', posted_journal_entry_id = v_je, posted_at = now(),
                          posted_by_user_id = v_user
        WHERE id = v_pay;

      INSERT INTO payment_applications (payment_id, invoice_id, applied_amount, applied_by_user_id)
      VALUES (v_pay, v_inv, v_total, v_user);

      UPDATE invoices SET status = 'paid' WHERE id = v_inv;
    END LOOP;

    -- Two unapplied customer prepayments (credit on account).
    FOR i IN 1..2 LOOP
      v_cust := v_custs[i];
      v_date := make_date(2026, 6, 5 + i);
      v_total := 500 * i;
      v_pay := gen_random_uuid();
      INSERT INTO payments (id, business_id, customer_id, payment_date, payment_method, reference,
                            amount, unapplied_amount, cash_account_id, status, created_by_user_id)
      VALUES (v_pay, r.id, v_cust, v_date, 'ach'::payment_method, 'PREPAY-' || i,
              v_total, v_total, v_cash, 'draft', v_user);
      v_je := seed_post_je(r.id, v_date, 'Customer prepayment', 'payment', v_pay,
        jsonb_build_array(
          jsonb_build_object('code','1020','debit',v_total,'credit',0),
          jsonb_build_object('code','1100','debit',0,'credit',v_total)));
      UPDATE payments SET status = 'posted', posted_journal_entry_id = v_je, posted_at = now(),
                          posted_by_user_id = v_user
        WHERE id = v_pay;
    END LOOP;

    -- Two posted credit memos (returns / allowances).
    FOR i IN 1..2 LOOP
      v_cust := v_custs[2 + i];
      v_date := make_date(2026, 5, 10 + i);
      v_total := 180 * i;
      v_cm := gen_random_uuid();
      INSERT INTO credit_memos (id, business_id, customer_id, memo_date, status, amount, remaining_amount,
                                ar_account_id, revenue_account_id, created_by_user_id, memo)
      VALUES (v_cm, r.id, v_cust, v_date, 'draft', v_total, v_total, v_ar, v_returns, v_user,
              'Returned merchandise credit');
      v_je := seed_post_je(r.id, v_date, 'Credit memo', 'credit_memo', v_cm,
        jsonb_build_array(
          jsonb_build_object('code','4910','debit',v_total,'credit',0),
          jsonb_build_object('code','1100','debit',0,'credit',v_total)));
      UPDATE credit_memos SET status = 'posted', posted_journal_entry_id = v_je, posted_at = now(),
                              posted_by_user_id = v_user
        WHERE id = v_cm;
    END LOOP;

  END LOOP;
END $$;
