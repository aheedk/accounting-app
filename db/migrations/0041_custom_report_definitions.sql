CREATE TABLE custom_report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crd_business ON custom_report_definitions(business_id);
CREATE TRIGGER custom_report_definitions_updated_at BEFORE UPDATE ON custom_report_definitions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
