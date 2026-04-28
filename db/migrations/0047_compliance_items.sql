CREATE TYPE compliance_item_key AS ENUM (
  'state_registration', 'new_hire_report', 'labor_law_poster', 'annual_filing'
);
CREATE TYPE compliance_item_status AS ENUM ('open', 'in_progress', 'done', 'na');

CREATE TABLE compliance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  item_key compliance_item_key NOT NULL,
  status compliance_item_status NOT NULL DEFAULT 'open',
  due_date date,
  notes text,
  document_file_id uuid REFERENCES files(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ci_unique UNIQUE (business_id, item_key)
);
CREATE INDEX idx_ci_business ON compliance_items(business_id);
CREATE TRIGGER compliance_items_updated_at BEFORE UPDATE ON compliance_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION seed_compliance_items() RETURNS trigger AS $$
BEGIN
  INSERT INTO compliance_items (business_id, item_key) VALUES
    (NEW.id, 'state_registration'),
    (NEW.id, 'new_hire_report'),
    (NEW.id, 'labor_law_poster'),
    (NEW.id, 'annual_filing')
  ON CONFLICT (business_id, item_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER businesses_seed_compliance
  AFTER INSERT ON businesses
  FOR EACH ROW EXECUTE FUNCTION seed_compliance_items();

DO $$
DECLARE b record;
BEGIN
  FOR b IN SELECT id FROM businesses LOOP
    INSERT INTO compliance_items (business_id, item_key) VALUES
      (b.id, 'state_registration'),
      (b.id, 'new_hire_report'),
      (b.id, 'labor_law_poster'),
      (b.id, 'annual_filing')
    ON CONFLICT (business_id, item_key) DO NOTHING;
  END LOOP;
END $$;
