-- The starting chart gets QuickBooks detail types, so a new company's Balance
-- Sheet groups as Bank / Fixed Assets / Long Term Liabilities from day one
-- instead of piling every account under Other Current Assets / Liabilities.
-- Spec: docs/specs/2026-10-12-account-types-design.md ("The starting chart").

-- The detail type of a starting-chart account. An account is recognised only
-- by its system key, or by the code, name and type it was seeded with; one the
-- client has renamed or retyped is theirs, and gets nothing (NULL).
CREATE OR REPLACE FUNCTION coa_default_detail_type(
  p_code text, p_name text, p_account_type text, p_system_key text
) RETURNS text AS $$
  SELECT CASE
    WHEN p_system_key = 'cash_on_hand'        AND p_account_type = 'asset'     THEN 'Cash on hand'
    WHEN p_system_key = 'operating_bank'      AND p_account_type = 'asset'     THEN 'Checking'
    WHEN p_system_key = 'accounts_receivable' AND p_account_type = 'asset'     THEN 'Accounts receivable (A/R)'
    WHEN p_system_key = 'accounts_payable'    AND p_account_type = 'liability' THEN 'AP'
    WHEN p_system_key = 'sales_tax_payable'   AND p_account_type = 'liability' THEN 'Sales Tax Payable'
    WHEN p_system_key = 'retained_earnings'   AND p_account_type = 'equity'    THEN 'Retained Earnings'
    ELSE (
      SELECT d.detail_type FROM (VALUES
        ('1200', 'Inventory',                    'asset',     'Inventory'),
        ('1500', 'Equipment',                    'asset',     'Machinery & Equipment'),
        ('1510', 'Accumulated Depreciation',     'asset',     'Accumulated Depreciation'),
        ('2200', 'Payroll Liabilities',          'liability', 'Payroll Tax Payable'),
        ('2500', 'Notes Payable',                'liability', 'Notes Payable'),
        ('3010', 'Owner Equity',                 'equity',    'Owner''s Equity'),
        ('3030', 'Owner Draws',                  'equity',    'Owner''s Equity'),
        ('4010', 'Sales Revenue',                'revenue',   'Sales of Product Income'),
        ('4020', 'Service Revenue',              'revenue',   'Service/Fee Income'),
        ('4910', 'Sales Returns and Allowances', 'revenue',   'Discounts/Refunds Given'),
        ('5010', 'Cost of Goods Sold',           'expense',   'Supplies & Materials - COGS'),
        ('5100', 'Salaries and Wages',           'expense',   'Payroll Wage Expenses'),
        ('5200', 'Rent',                         'expense',   'Rent or Lease of Buildings'),
        ('5300', 'Utilities',                    'expense',   'Utilities'),
        ('5400', 'Office Supplies',              'expense',   'Office/General Administrative Expenses'),
        ('5500', 'Software Subscriptions',       'expense',   'Dues & subscriptions'),
        ('5600', 'Bank Fees',                    'expense',   'Bank Charges'),
        ('5700', 'Professional Fees',            'expense',   'Legal & Professional Fees'),
        ('5800', 'Travel and Meals',             'expense',   'Travel'),
        ('5900', 'Insurance',                    'expense',   'Insurance'),
        ('5910', 'Depreciation Expense',         'expense',   'Depreciation'),
        ('5950', 'Miscellaneous Expense',        'expense',   'Other Business Expenses')
      ) AS d(code, name, account_type, detail_type)
      WHERE d.code = p_code AND d.name = p_name AND d.account_type = p_account_type
    )
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Same accounts as 0009; each now leaves with its detail type.
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

  -- After the insert, so system keys (set by trigger) are in place.
  UPDATE chart_of_accounts
  SET detail_type = coa_default_detail_type(code, name, account_type::text, system_key)
  WHERE business_id = p_business_id
    AND detail_type IS NULL
    AND coa_default_detail_type(code, name, account_type::text, system_key) IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Existing companies: only blanks, and only starting-chart accounts. A detail
-- type someone chose is never overwritten (Suspense is found by its own).
UPDATE chart_of_accounts
SET detail_type = coa_default_detail_type(code, name, account_type::text, system_key)
WHERE detail_type IS NULL
  AND coa_default_detail_type(code, name, account_type::text, system_key) IS NOT NULL;
