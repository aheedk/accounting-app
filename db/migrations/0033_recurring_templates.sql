CREATE TYPE recurring_template_type AS ENUM ('journal_entry', 'invoice', 'bill');
CREATE TYPE recurring_template_recurrence AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');

CREATE TABLE recurring_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  template_type recurring_template_type NOT NULL,
  payload jsonb NOT NULL,
  recurrence recurring_template_recurrence NOT NULL,
  next_run_date date NOT NULL,
  end_date date,
  last_run_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT rt_end_after_next CHECK (end_date IS NULL OR end_date >= next_run_date)
);

CREATE INDEX idx_rt_business ON recurring_templates(business_id);
CREATE INDEX idx_rt_due ON recurring_templates(business_id, next_run_date) WHERE is_active = true;

CREATE TRIGGER recurring_templates_updated_at
  BEFORE UPDATE ON recurring_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
