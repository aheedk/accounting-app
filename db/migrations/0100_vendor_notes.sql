-- Freeform notes on a vendor's own Notes tab (QBO vendor-detail polish,
-- 2026-10-13). Plain timestamped text entries, separate from the single
-- vendors.notes field (which stays as the one-line "Notes" shown on the New/Edit
-- vendor form and the Vendor Details tab) -- QBO itself keeps the same split.
CREATE TABLE vendor_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  user_id uuid NOT NULL REFERENCES users(id),
  note_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_notes_vendor_id_idx ON vendor_notes(vendor_id, created_at DESC);
