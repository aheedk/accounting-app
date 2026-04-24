CREATE TYPE integration_source AS ENUM ('stripe_csv', 'paypal_csv', 'shopify_csv', 'generic');
CREATE TYPE integration_inbox_status AS ENUM ('pending', 'matched', 'categorized', 'excluded');

CREATE TABLE integration_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  source integration_source NOT NULL,
  external_id text,
  occurred_at date NOT NULL,
  description text NOT NULL,
  amount numeric(19,4) NOT NULL,
  raw_payload jsonb NOT NULL,
  status integration_inbox_status NOT NULL DEFAULT 'pending',
  matched_journal_entry_id uuid REFERENCES journal_entries(id),
  excluded_reason text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users(id),
  CONSTRAINT ii_terminal_has_reviewer CHECK (
    (status = 'pending' AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT ii_matched_has_je CHECK (
    (status IN ('matched','categorized')) = (matched_journal_entry_id IS NOT NULL)
  ),
  CONSTRAINT ii_excluded_has_reason CHECK (
    (status = 'excluded') = (excluded_reason IS NOT NULL)
  )
);
CREATE INDEX idx_ii_biz_status ON integration_inbox(business_id, status);
CREATE UNIQUE INDEX uq_ii_external ON integration_inbox(business_id, source, external_id) WHERE external_id IS NOT NULL;
