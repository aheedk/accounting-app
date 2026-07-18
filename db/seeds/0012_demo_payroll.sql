-- Demo Payroll: finalized pay runs (+per-employee lines +balanced JE) and
-- payroll tax liabilities. Pay run posts a JE crediting cash + liabilities and
-- debiting wage / employer-tax expense. Idempotent per business.
DO $$
DECLARE
  r record;
  v_user uuid;
  a_wages uuid; a_cash uuid; a_liab uuid;
  v_emps uuid[];
  v_emp uuid;
  v_pr uuid; v_je uuid;
  v_periods date[][] := ARRAY[
    ARRAY['2026-05-01','2026-05-15','2026-05-20']::date[],
    ARRAY['2026-05-16','2026-05-31','2026-06-05']::date[],
    ARRAY['2026-06-01','2026-06-15','2026-06-20']::date[]
  ];
  v_pstart date; v_pend date; v_pdate date;
  v_gross numeric; v_fed numeric; v_st numeric; v_ficae numeric; v_mede numeric;
  v_ficaer numeric; v_meder numeric; v_net numeric;
  t_gross numeric; t_net numeric; t_liab numeric; t_ertax numeric;
  i int; k int;
BEGIN
  SELECT id INTO v_user FROM users WHERE email = 'admin@example.com' LIMIT 1;

  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF EXISTS (SELECT 1 FROM pay_runs WHERE business_id = r.id) THEN
      CONTINUE;
    END IF;

    SELECT id INTO a_wages FROM chart_of_accounts WHERE business_id = r.id AND code = '5100';
    SELECT id INTO a_cash  FROM chart_of_accounts WHERE business_id = r.id AND code = '1020';
    SELECT id INTO a_liab  FROM chart_of_accounts WHERE business_id = r.id AND code = '2200';
    SELECT array_agg(id ORDER BY full_name) INTO v_emps FROM employees WHERE business_id = r.id AND is_active;

    FOR i IN 1..3 LOOP
      v_pstart := v_periods[i][1];
      v_pend   := v_periods[i][2];
      v_pdate  := v_periods[i][3];
      v_pr := gen_random_uuid();

      INSERT INTO pay_runs (id, business_id, pay_period_start, pay_period_end, pay_date, status,
                            wages_expense_account_id, payroll_tax_expense_account_id, cash_account_id,
                            fed_tax_liability_account_id, state_tax_liability_account_id,
                            fica_liability_account_id, memo, created_by_user_id)
      VALUES (v_pr, r.id, v_pstart, v_pend, v_pdate, 'draft',
              a_wages, a_wages, a_cash, a_liab, a_liab, a_liab, 'Biweekly payroll', v_user);

      t_gross := 0; t_net := 0; t_liab := 0; t_ertax := 0;
      FOR k IN 1..array_length(v_emps, 1) LOOP
        v_emp := v_emps[k];
        v_gross := 2000 + k * 250;
        v_fed   := round(v_gross * 0.12, 2);
        v_st    := round(v_gross * 0.05, 2);
        v_ficae := round(v_gross * 0.062, 2);
        v_mede  := round(v_gross * 0.0145, 2);
        v_ficaer := v_ficae;
        v_meder  := v_mede;
        v_net   := v_gross - v_fed - v_st - v_ficae - v_mede;

        INSERT INTO pay_run_lines (pay_run_id, employee_id, gross, federal_wh, state_wh,
                                   fica_employee, fica_employer, medicare_employee, medicare_employer,
                                   other_deductions, net)
        VALUES (v_pr, v_emp, v_gross, v_fed, v_st, v_ficae, v_ficaer, v_mede, v_meder, 0, v_net);

        t_gross := t_gross + v_gross;
        t_net   := t_net + v_net;
        t_ertax := t_ertax + v_ficaer + v_meder;
        t_liab  := t_liab + v_fed + v_st + v_ficae + v_mede + v_ficaer + v_meder;
      END LOOP;

      v_je := seed_post_je(r.id, v_pdate, 'Payroll ' || to_char(v_pdate, 'YYYY-MM-DD'), 'adjustment', NULL,
        jsonb_build_array(
          jsonb_build_object('code','5100','debit',t_gross,'credit',0),
          jsonb_build_object('code','5100','debit',t_ertax,'credit',0),
          jsonb_build_object('code','1020','debit',0,'credit',t_net),
          jsonb_build_object('code','2200','debit',0,'credit',t_liab)));

      UPDATE pay_runs SET status = 'finalized', journal_entry_id = v_je, finalized_at = now(),
                          finalized_by_user_id = v_user
        WHERE id = v_pr;
    END LOOP;

    -- Payroll tax liabilities (a couple accrued, one paid).
    INSERT INTO payroll_tax_liabilities (business_id, period, period_start, period_end, liability_account_id, amount, status, notes)
    VALUES
      (r.id, 'quarterly', '2026-04-01', '2026-06-30', a_liab, 4200.00, 'accrued', 'Q2 federal + FICA accrual'),
      (r.id, 'monthly',   '2026-06-01', '2026-06-30', a_liab, 1450.00, 'accrued', 'June state withholding');

    v_je := seed_post_je(r.id, '2026-04-15', 'Payroll tax deposit Q1', 'adjustment', NULL,
      jsonb_build_array(
        jsonb_build_object('code','2200','debit',3900.00,'credit',0),
        jsonb_build_object('code','1020','debit',0,'credit',3900.00)));
    INSERT INTO payroll_tax_liabilities (business_id, period, period_start, period_end, liability_account_id, amount, status, paid_at, payment_journal_entry_id, notes)
    VALUES (r.id, 'quarterly', '2026-01-01', '2026-03-31', a_liab, 3900.00, 'paid', now(), v_je, 'Q1 deposit remitted');

  END LOOP;
END $$;
