CREATE TABLE invoice_import_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL UNIQUE,
  email_from text,
  email_subject text,
  received_at timestamptz NOT NULL,
  invoice_type text NOT NULL CHECK (invoice_type IN ('ap', 'ar')),
  vendor_customer text,
  invoice_number text,
  invoice_date text,
  due_date text,
  line_items jsonb NOT NULL DEFAULT '[]',
  subtotal text,
  tax_amount text,
  total text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
