-- Demo master/reference data for every business: customers, vendors, employees,
-- inventory items, cost centers, tax codes, compliance items, recurring
-- templates, budgets and period-review tasks. Idempotent per subsection.
DO $$
DECLARE
  r record;
  v_user uuid;
  v_inv_asset uuid;
  v_income uuid;
  v_cogs uuid;
  v_tax_acct uuid;
  v_budget uuid;
  v_period uuid;
  v_acct uuid;
  v_code text;
  m int;
BEGIN
  SELECT id INTO v_user FROM users WHERE email = 'admin@example.com' LIMIT 1;

  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    SELECT id INTO v_inv_asset FROM chart_of_accounts WHERE business_id = r.id AND code = '1200';
    SELECT id INTO v_income    FROM chart_of_accounts WHERE business_id = r.id AND code = '4010';
    SELECT id INTO v_cogs      FROM chart_of_accounts WHERE business_id = r.id AND code = '5010';
    SELECT id INTO v_tax_acct  FROM chart_of_accounts WHERE business_id = r.id AND code = '2100';

    -- Customers ----------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM customers WHERE business_id = r.id AND name = 'Northwind Traders') THEN
      INSERT INTO customers (business_id, name, company_name, email, phone, default_terms_days, customer_type) VALUES
        (r.id, 'Northwind Traders',   'Northwind Traders LLC',    'ap@northwind.example.com',   '555-0110', 30, 'business'),
        (r.id, 'Contoso Ltd',         'Contoso Ltd',              'billing@contoso.example.com','555-0111', 30, 'business'),
        (r.id, 'Fabrikam Inc',        'Fabrikam Inc',             'pay@fabrikam.example.com',   '555-0112', 15, 'business'),
        (r.id, 'Tailspin Toys',       'Tailspin Toys',            'orders@tailspin.example.com','555-0113', 45, 'business'),
        (r.id, 'Wingtip Partners',    'Wingtip Partners',         'finance@wingtip.example.com','555-0114', 30, 'business'),
        (r.id, 'Jordan Avery',        NULL,                       'jordan.avery@example.com',   '555-0115', 15, 'individual');
    END IF;

    -- Vendors ------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM vendors WHERE business_id = r.id AND name = 'Pacific Office Supply') THEN
      INSERT INTO vendors (business_id, name, company_name, email, phone, default_terms_days, is_1099) VALUES
        (r.id, 'Pacific Office Supply', 'Pacific Office Supply Co.', 'orders@pacoffice.example.com', '555-0200', 30, false),
        (r.id, 'Metro Utilities',       'Metro Utilities',          'billing@metroutil.example.com','555-0201', 21, false),
        (r.id, 'CloudWorks SaaS',       'CloudWorks Inc',           'ar@cloudworks.example.com',    '555-0202', 30, false),
        (r.id, 'Harbor Logistics',      'Harbor Logistics LLC',     'freight@harborlog.example.com','555-0203', 30, false),
        (r.id, 'Dana Brooks Design',    NULL,                       'dana@brooksdesign.example.com','555-0204', 15, true),
        (r.id, 'Summit Legal',          'Summit Legal LLP',         'invoices@summitlegal.example.com','555-0205', 30, true);
    END IF;

    -- Cost centers -------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM cost_centers WHERE business_id = r.id AND name = 'Operations') THEN
      INSERT INTO cost_centers (business_id, name, code) VALUES
        (r.id, 'Operations', 'OPS'),
        (r.id, 'Sales & Marketing', 'S&M'),
        (r.id, 'Administration', 'ADMIN');
    END IF;

    -- Extra tax codes ----------------------------------------------------
    IF v_tax_acct IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_codes WHERE business_id = r.id AND code = 'NY') THEN
      INSERT INTO tax_codes (business_id, code, name, tax_payable_account_id)
        VALUES (r.id, 'NY', 'NY Sales Tax 8.0%', v_tax_acct);
      INSERT INTO tax_rates (tax_code_id, rate, effective_from)
        SELECT id, 0.08, '2000-01-01' FROM tax_codes WHERE business_id = r.id AND code = 'NY';
    END IF;

    -- Employees ----------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM employees WHERE business_id = r.id AND full_name = 'Morgan Lee') THEN
      INSERT INTO employees (business_id, full_name, email, phone, hire_date, default_pay_rate_cents, default_pay_frequency, w4_filing_status) VALUES
        (r.id, 'Morgan Lee',    'morgan.lee@acme.example.com',   '555-0300', '2023-02-01', 520000, 'biweekly',    'single'),
        (r.id, 'Sam Rivera',    'sam.rivera@acme.example.com',   '555-0301', '2022-09-15', 610000, 'biweekly',    'married_jointly'),
        (r.id, 'Priya Nair',    'priya.nair@acme.example.com',   '555-0302', '2024-01-08', 480000, 'biweekly',    'single'),
        (r.id, 'Diego Santos',  'diego.santos@acme.example.com', '555-0303', '2021-06-21', 720000, 'semimonthly', 'head_of_household'),
        (r.id, 'Casey Kim',     'casey.kim@acme.example.com',    '555-0304', '2023-11-13', 455000, 'biweekly',    'single');
    END IF;

    -- Inventory items ----------------------------------------------------
    IF v_inv_asset IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_items WHERE business_id = r.id AND sku = 'WID-100') THEN
      INSERT INTO inventory_items (business_id, sku, name, description, unit_of_measure, purchase_cost, sale_price, income_account_id, expense_account_id, inventory_asset_account_id) VALUES
        (r.id, 'WID-100', 'Standard Widget',  'Standard-grade widget',        'each', 4.50, 12.00, v_income, v_cogs, v_inv_asset),
        (r.id, 'WID-200', 'Premium Widget',   'Premium widget, anodized',     'each', 9.25, 24.00, v_income, v_cogs, v_inv_asset),
        (r.id, 'GAD-300', 'Mini Gadget',      'Compact gadget',               'each', 6.10, 18.50, v_income, v_cogs, v_inv_asset),
        (r.id, 'GAD-400', 'Deluxe Gadget',    'Deluxe gadget with case',      'each', 14.00, 39.00, v_income, v_cogs, v_inv_asset),
        (r.id, 'KIT-500', 'Starter Kit',      'Widget + gadget bundle',       'kit',  18.00, 49.00, v_income, v_cogs, v_inv_asset),
        (r.id, 'ACC-600', 'Cable Pack',       'Replacement cable pack',       'pack', 1.75,  6.00, v_income, v_cogs, v_inv_asset),
        (r.id, 'ACC-700', 'Mounting Bracket', 'Universal mounting bracket',   'each', 3.20,  9.50, v_income, v_cogs, v_inv_asset),
        (r.id, 'SVC-900', 'Onsite Setup',     'Onsite installation service',  'hour', 0.00, 95.00, v_income, v_cogs, v_inv_asset);
      -- Opening stock for the physical items
      INSERT INTO stock_movements (inventory_item_id, movement_date, quantity_delta, reason, memo, posted_by_user_id)
      SELECT id, '2026-01-05', 250, 'opening_balance', 'Opening stock', v_user
        FROM inventory_items WHERE business_id = r.id AND sku <> 'SVC-900';
    END IF;

    -- Compliance items ---------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM compliance_items WHERE business_id = r.id AND item_key = 'state_registration') THEN
      INSERT INTO compliance_items (business_id, item_key, status, due_date, notes) VALUES
        (r.id, 'state_registration', 'done',        '2026-01-31', 'State employer registration filed.'),
        (r.id, 'new_hire_report',    'in_progress', '2026-07-15', 'Report new hires from Q2.'),
        (r.id, 'labor_law_poster',   'open',        '2026-08-01', 'Order updated 2026 poster set.'),
        (r.id, 'annual_filing',      'open',        '2026-12-31', 'Annual report due to Secretary of State.');
    END IF;

    -- Recurring templates (future-dated so they are not auto-run) ---------
    IF NOT EXISTS (SELECT 1 FROM recurring_templates WHERE business_id = r.id AND name = 'Monthly Office Rent') THEN
      INSERT INTO recurring_templates (business_id, name, template_type, payload, recurrence, next_run_date, is_active, created_by_user_id) VALUES
        (r.id, 'Monthly Office Rent', 'journal_entry',
         jsonb_build_object('memo', 'Office rent', 'lines',
           jsonb_build_array(
             jsonb_build_object('account_code','5200','debit',2500,'credit',0),
             jsonb_build_object('account_code','1020','debit',0,'credit',2500))),
         'monthly', '2026-07-01', true, v_user),
        (r.id, 'Quarterly Insurance', 'journal_entry',
         jsonb_build_object('memo', 'Insurance premium', 'lines',
           jsonb_build_array(
             jsonb_build_object('account_code','5900','debit',1200,'credit',0),
             jsonb_build_object('account_code','1020','debit',0,'credit',1200))),
         'quarterly', '2026-09-01', true, v_user);
    END IF;

    -- Budget + lines (current fiscal year) -------------------------------
    IF NOT EXISTS (SELECT 1 FROM budgets WHERE business_id = r.id AND fiscal_year = 2026) THEN
      INSERT INTO budgets (business_id, name, fiscal_year, status, created_by_user_id)
        VALUES (r.id, '2026 Operating Budget', 2026, 'active', v_user)
        RETURNING id INTO v_budget;
      -- A monthly figure for a handful of revenue/expense accounts.
      FOR v_code, v_acct IN
        SELECT code, id FROM chart_of_accounts
         WHERE business_id = r.id AND code IN ('4010','5100','5200','5300','5500')
      LOOP
        FOR m IN 0..11 LOOP
          INSERT INTO budget_lines (budget_id, account_id, month_offset, amount)
          VALUES (
            v_budget, v_acct, m,
            CASE v_code
              WHEN '4010' THEN 40000
              WHEN '5100' THEN 18000
              WHEN '5200' THEN 2500
              WHEN '5300' THEN 900
              WHEN '5500' THEN 600
              ELSE 0 END
          );
        END LOOP;
      END LOOP;
    END IF;

    -- Period-review tasks are auto-created per period by a trigger; vary the
    -- current period's statuses so the Books Review section isn't all "todo".
    SELECT id INTO v_period FROM fiscal_periods
      WHERE business_id = r.id AND starts_on <= CURRENT_DATE AND ends_on >= CURRENT_DATE
      ORDER BY starts_on LIMIT 1;
    IF v_period IS NOT NULL THEN
      UPDATE period_review_tasks SET status = 'in_progress', notes = 'Reconcile primary checking.'
        WHERE business_id = r.id AND period_id = v_period AND task_key = 'reconcile_bank';
      UPDATE period_review_tasks
         SET status = 'done', notes = 'Adjusting entries posted.',
             signed_off_at = now(), signed_off_by_user_id = v_user
        WHERE business_id = r.id AND period_id = v_period AND task_key = 'post_adjustments';
    END IF;

  END LOOP;
END $$;
