CREATE TYPE budget_status AS ENUM ('draft', 'active', 'archived');

CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  fiscal_year int NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  status budget_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT budgets_unique UNIQUE (business_id, fiscal_year, name)
);
CREATE INDEX idx_budgets_business ON budgets(business_id);
CREATE TRIGGER budgets_updated_at BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
