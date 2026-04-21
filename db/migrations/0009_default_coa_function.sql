-- Seeds a standard small-business COA for the given business.
-- Codes follow the convention: 1xxx assets, 2xxx liabilities, 3xxx equity,
-- 4xxx revenue, 5xxx expenses. System accounts are flagged is_system=true
-- so the COA UI cannot delete them.
CREATE OR REPLACE FUNCTION seed_default_coa(p_business_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
    (p_business_id, '1010', 'Cash on Hand',                'asset',     true),
    (p_business_id, '1020', 'Operating Bank Account',      'asset',     true),
    (p_business_id, '1100', 'Accounts Receivable',         'asset',     true),
    (p_business_id, '1200', 'Inventory',                   'asset',     false),
    (p_business_id, '1500', 'Equipment',                   'asset',     false),
    (p_business_id, '1510', 'Accumulated Depreciation',    'asset',     false),

    (p_business_id, '2010', 'Accounts Payable',            'liability', true),
    (p_business_id, '2100', 'Sales Tax Payable',           'liability', true),
    (p_business_id, '2200', 'Payroll Liabilities',         'liability', false),
    (p_business_id, '2500', 'Notes Payable',               'liability', false),

    (p_business_id, '3010', 'Owner Equity',                'equity',    false),
    (p_business_id, '3020', 'Retained Earnings',           'equity',    true),
    (p_business_id, '3030', 'Owner Draws',                 'equity',    false),

    (p_business_id, '4010', 'Sales Revenue',               'revenue',   false),
    (p_business_id, '4020', 'Service Revenue',             'revenue',   false),
    (p_business_id, '4910', 'Sales Returns and Allowances','revenue',   false),

    (p_business_id, '5010', 'Cost of Goods Sold',          'expense',   false),
    (p_business_id, '5100', 'Salaries and Wages',          'expense',   false),
    (p_business_id, '5200', 'Rent',                        'expense',   false),
    (p_business_id, '5300', 'Utilities',                   'expense',   false),
    (p_business_id, '5400', 'Office Supplies',             'expense',   false),
    (p_business_id, '5500', 'Software Subscriptions',      'expense',   false),
    (p_business_id, '5600', 'Bank Fees',                   'expense',   false),
    (p_business_id, '5700', 'Professional Fees',           'expense',   false),
    (p_business_id, '5800', 'Travel and Meals',            'expense',   false),
    (p_business_id, '5900', 'Insurance',                   'expense',   false),
    (p_business_id, '5910', 'Depreciation Expense',        'expense',   false),
    (p_business_id, '5950', 'Miscellaneous Expense',       'expense',   false)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Seeds 12 monthly fiscal periods for the given calendar year.
CREATE OR REPLACE FUNCTION seed_calendar_year_periods(p_business_id uuid, p_year int)
RETURNS void AS $$
DECLARE
  m int;
BEGIN
  FOR m IN 1..12 LOOP
    INSERT INTO fiscal_periods (business_id, starts_on, ends_on, status)
    VALUES (
      p_business_id,
      make_date(p_year, m, 1),
      (make_date(p_year, m, 1) + interval '1 month' - interval '1 day')::date,
      'open'
    )
    ON CONFLICT (business_id, starts_on) DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
