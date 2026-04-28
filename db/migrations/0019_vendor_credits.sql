CREATE TYPE vendor_credit_status AS ENUM ('draft', 'posted', 'applied', 'voided');

CREATE TABLE vendor_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  credit_date date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  remaining_amount numeric(19,4) NOT NULL CHECK (remaining_amount >= 0),
  offset_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  ap_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  status vendor_credit_status NOT NULL DEFAULT 'draft',
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vc_remaining_le_amount CHECK (remaining_amount <= amount),
  CONSTRAINT vc_posted_has_je CHECK ((status = 'draft' AND posted_journal_entry_id IS NULL) OR (status <> 'draft'))
);
CREATE INDEX idx_vendor_credits_biz_status ON vendor_credits(business_id, status);
CREATE INDEX idx_vendor_credits_vendor ON vendor_credits(vendor_id);
CREATE TRIGGER vendor_credits_updated_at BEFORE UPDATE ON vendor_credits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Close the FK loop on bill_payment_applications now that vendor_credits exists
ALTER TABLE bill_payment_applications
  ADD CONSTRAINT bpa_vendor_credit_fk FOREIGN KEY (vendor_credit_id) REFERENCES vendor_credits(id);
