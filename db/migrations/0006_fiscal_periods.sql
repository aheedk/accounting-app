CREATE TYPE fiscal_period_status AS ENUM ('open', 'closed');

CREATE TABLE fiscal_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status fiscal_period_status NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  closed_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, starts_on),
  CHECK (starts_on <= ends_on),
  EXCLUDE USING gist (
    business_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);

CREATE INDEX idx_fp_business_status ON fiscal_periods (business_id, status);

CREATE TRIGGER trg_fp_updated_at
  BEFORE UPDATE ON fiscal_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();
