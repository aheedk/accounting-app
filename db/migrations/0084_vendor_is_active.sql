-- "Make inactive" (hide from dropdowns, keep transaction history) is distinct
-- from Delete (hard-remove, only allowed with zero transactions) -- vendors.
-- deleted_at already exists but means "gone"; this is the reversible toggle.
ALTER TABLE vendors ADD COLUMN is_active boolean NOT NULL DEFAULT true;
CREATE INDEX idx_vendors_business_active ON vendors (business_id) WHERE is_active AND deleted_at IS NULL;
