CREATE TABLE budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  month_offset int NOT NULL CHECK (month_offset BETWEEN 0 AND 11),
  amount numeric(19,4) NOT NULL DEFAULT 0,
  CONSTRAINT bl_unique UNIQUE (budget_id, account_id, month_offset)
);
CREATE INDEX idx_bl_budget ON budget_lines(budget_id);
CREATE INDEX idx_bl_account ON budget_lines(account_id);
