-- Which product/service an invoice line was for. The picker already matches a
-- name to a revenue account when an invoice is written, but the match itself
-- was thrown away once the line posted, so Sales by Product/Service had
-- nothing to read. NULL on every line written before this, and on any line a
-- user leaves blank (free-text lines are still allowed) — "Not Specified" on
-- the report, the same way Expenses by Vendor already handles a line with no
-- name. ON DELETE SET NULL: deleting the product/service later must not take
-- a posted invoice line down with it.
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoice_lines_inventory_item_idx
  ON invoice_lines (inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;
