CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email text,
  phone text,
  billing_address jsonb,
  tax_id text,
  is_1099 boolean NOT NULL DEFAULT false,
  default_terms_days int NOT NULL DEFAULT 30 CHECK (default_terms_days BETWEEN 0 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_vendors_business_name ON vendors(business_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendors_biz ON vendors(business_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendors_1099 ON vendors(business_id) WHERE is_1099 = true AND deleted_at IS NULL;
CREATE TRIGGER vendors_updated_at BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
