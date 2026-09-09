-- Dedicated import email address per business.
-- When the Gmail worker receives a message addressed to this email, it routes
-- the document to this business directly (no AI name-matching needed).
-- Falls back to AI addressed_to extraction when no business matches the To: header.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS import_email text;

CREATE UNIQUE INDEX IF NOT EXISTS businesses_import_email_idx
  ON businesses (import_email)
  WHERE import_email IS NOT NULL;
