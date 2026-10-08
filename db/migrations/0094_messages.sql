-- Messages between a client and the firm, one thread per company
-- (docs/specs/2026-10-08-accounts-and-roles-design.md). A client had no way to
-- ask a question or be asked one inside the app.
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  author_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_business ON messages (business_id, created_at DESC);

-- When each person last read a company's thread; anything newer from someone else is unread.
CREATE TABLE IF NOT EXISTS message_reads (
  user_id uuid NOT NULL REFERENCES users(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);
