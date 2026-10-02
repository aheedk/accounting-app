-- Track whether a payment has been included in a bank deposit
ALTER TABLE payments ADD COLUMN is_deposited BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX payments_is_deposited ON payments(business_id, is_deposited) WHERE is_deposited = false;

-- Deposit lines: distinguish undeposited-funds lines from ad-hoc "other funds" lines
ALTER TABLE bank_deposit_lines
  ADD COLUMN line_type TEXT NOT NULL DEFAULT 'other_funds'
    CHECK (line_type IN ('undeposited_funds', 'other_funds')),
  ADD COLUMN payment_id UUID REFERENCES payments(id);

-- Allow recurring templates to be of type 'deposit'. template_type is a real
-- Postgres enum (see 0033_recurring_templates.sql), not a CHECK-constrained
-- text column, so it's extended the same way journal_entry_source_type is
-- elsewhere (e.g. 0058, 0060) rather than via a text CHECK constraint.
ALTER TYPE recurring_template_type ADD VALUE IF NOT EXISTS 'deposit';

-- Store recurrence_type (scheduled / reminder / unscheduled) in recurring templates
ALTER TABLE recurring_templates
  ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'unscheduled'
    CHECK (recurrence_type IN ('scheduled', 'reminder', 'unscheduled')),
  ADD COLUMN days_in_advance INTEGER;
