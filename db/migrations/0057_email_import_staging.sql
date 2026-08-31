CREATE TABLE email_import_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL UNIQUE,
  email_from text,
  email_subject text,
  received_at timestamptz NOT NULL,
  extracted_transactions jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
