CREATE TYPE receipt_linked_entity_type AS ENUM (
  'bank_transaction', 'bill', 'expense_transaction', 'invoice', 'journal_entry', 'unlinked'
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  file_id uuid NOT NULL REFERENCES files(id),
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  linked_entity_type receipt_linked_entity_type NOT NULL DEFAULT 'unlinked',
  linked_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipts_link_consistent CHECK (
    (linked_entity_type = 'unlinked') = (linked_entity_id IS NULL)
  )
);
CREATE INDEX idx_receipts_business ON receipts(business_id);
CREATE INDEX idx_receipts_link ON receipts(linked_entity_type, linked_entity_id) WHERE linked_entity_type <> 'unlinked';
CREATE TRIGGER receipts_updated_at BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
