CREATE TYPE fixed_asset_status AS ENUM ('active', 'disposed');
CREATE TYPE depreciation_method AS ENUM ('straight_line');

CREATE TABLE fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  asset_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  depreciation_expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  accumulated_depreciation_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  purchase_date date NOT NULL,
  cost numeric(19,4) NOT NULL CHECK (cost > 0),
  salvage_value numeric(19,4) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_years int NOT NULL CHECK (useful_life_years BETWEEN 1 AND 100),
  depreciation_method depreciation_method NOT NULL DEFAULT 'straight_line',
  status fixed_asset_status NOT NULL DEFAULT 'active',
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT fa_salvage_lt_cost CHECK (salvage_value < cost)
);
CREATE INDEX idx_fa_biz ON fixed_assets(business_id) WHERE deleted_at IS NULL;
CREATE TRIGGER fa_updated_at BEFORE UPDATE ON fixed_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE depreciation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_end date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by_user_id uuid REFERENCES users(id),
  CONSTRAINT de_unique_period UNIQUE (fixed_asset_id, period_end)
);
CREATE INDEX idx_de_asset ON depreciation_entries(fixed_asset_id);
