CREATE TYPE period_review_task_key AS ENUM (
  'reconcile_bank',
  'post_adjustments',
  'review_unreviewed_txns',
  'close_period'
);

CREATE TYPE period_review_task_status AS ENUM ('todo', 'in_progress', 'done');

CREATE TABLE period_review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  period_id uuid NOT NULL REFERENCES fiscal_periods(id),
  task_key period_review_task_key NOT NULL,
  status period_review_task_status NOT NULL DEFAULT 'todo',
  assignee_user_id uuid REFERENCES users(id),
  notes text,
  signed_off_at timestamptz,
  signed_off_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prt_unique_period_task UNIQUE (period_id, task_key),
  CONSTRAINT prt_signed_off_done CHECK (
    (status = 'done') = (signed_off_at IS NOT NULL)
  )
);

CREATE INDEX idx_prt_business ON period_review_tasks(business_id);
CREATE INDEX idx_prt_period ON period_review_tasks(period_id);

CREATE TRIGGER period_review_tasks_updated_at
  BEFORE UPDATE ON period_review_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION seed_period_review_tasks() RETURNS trigger AS $$
BEGIN
  INSERT INTO period_review_tasks (business_id, period_id, task_key)
  VALUES
    (NEW.business_id, NEW.id, 'reconcile_bank'),
    (NEW.business_id, NEW.id, 'post_adjustments'),
    (NEW.business_id, NEW.id, 'review_unreviewed_txns'),
    (NEW.business_id, NEW.id, 'close_period');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fiscal_periods_seed_review_tasks
  AFTER INSERT ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION seed_period_review_tasks();

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT id, business_id FROM fiscal_periods LOOP
    INSERT INTO period_review_tasks (business_id, period_id, task_key) VALUES
      (p.business_id, p.id, 'reconcile_bank'),
      (p.business_id, p.id, 'post_adjustments'),
      (p.business_id, p.id, 'review_unreviewed_txns'),
      (p.business_id, p.id, 'close_period')
    ON CONFLICT (period_id, task_key) DO NOTHING;
  END LOOP;
END $$;
