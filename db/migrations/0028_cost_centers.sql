-- Slice 6: cost_centers provide a lightweight tagging dimension per business.
-- No ledger integration yet (deferred to Slice 7+), so this is pure CRUD.

CREATE TABLE cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  code text CHECK (code IS NULL OR length(code) BETWEEN 1 AND 50),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_cost_centers_biz ON cost_centers(business_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_cost_centers_biz_code
  ON cost_centers(business_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE TRIGGER cost_centers_updated_at
  BEFORE UPDATE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
