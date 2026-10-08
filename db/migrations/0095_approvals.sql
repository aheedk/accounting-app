-- The approval step (docs/specs/2026-10-08-accounts-and-roles-design.md).
--
-- The original design says staff make drafts and an accountant posts. That
-- holds for invoices, bills and payments. Expenses, checks, deposits, bank
-- lines, item receipts and stock adjustments have no draft: they are in the
-- books the moment they are saved. With this switched on for a company, what a
-- staff login saves of those waits here until an accountant approves it.
-- Off by default: nothing changes for a company until a firm admin turns it on.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS staff_entries_need_approval boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  -- What was being done, e.g. 'expense.create', and the request itself, kept
  -- as it was sent so that approving it does exactly what saving it would have.
  action text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  payload jsonb NOT NULL,
  -- A line a person can read: "Expense to Staples", and the amount when there is one.
  summary text NOT NULL,
  amount numeric(19,4),
  -- 'approving' is held only while the entry is being recorded, so two people
  -- approving at once cannot record it twice.
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approving', 'approved', 'rejected')),
  decided_by_user_id uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  -- What recording it returned, which names the record that was made.
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_business ON approval_requests (business_id, status, created_at DESC);
