ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS closed_by_user_id uuid REFERENCES users(id);
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS close_memo text;
