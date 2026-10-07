-- Inventory in the ledger (docs/specs/2026-10-07-inventory-ledger-design.md).
-- Each stock movement now carries what it cost and the journal entry that
-- recorded it, so the stock on hand and the Inventory account can agree.
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS unit_cost numeric(19,4),
  ADD COLUMN IF NOT EXISTS total_cost numeric(19,4),
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_journal_entry
  ON stock_movements(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

-- Receipts recorded before this: they came in on a purchase order at its unit
-- cost, and the bill the receipt posted (debit Inventory, credit A/P) is their
-- journal entry.
UPDATE stock_movements sm
   SET unit_cost = pol.unit_cost,
       total_cost = ROUND(sm.quantity_delta * pol.unit_cost, 4),
       journal_entry_id = b.posted_journal_entry_id
  FROM inventory_items i, purchase_orders po, purchase_order_lines pol, item_receipts ir, bills b
 WHERE i.id = sm.inventory_item_id
   AND po.business_id = i.business_id
   AND pol.purchase_order_id = po.id
   AND pol.inventory_item_id = sm.inventory_item_id
   AND pol.quantity = sm.quantity_delta
   AND ir.purchase_order_id = po.id
   AND ir.receipt_date = sm.movement_date
   AND b.id = ir.bill_id
   AND sm.reason = 'manual_in'
   AND sm.memo = 'Item receipt for ' || po.po_number
   AND sm.unit_cost IS NULL;

-- Everything else recorded before this is costed at the item's purchase cost,
-- which is what the Inventory page has always valued stock at. These have no
-- journal entry; "Post opening balance" on the Inventory page records them.
UPDATE stock_movements sm
   SET unit_cost = COALESCE(i.purchase_cost, 0),
       total_cost = ROUND(sm.quantity_delta * COALESCE(i.purchase_cost, 0), 4)
  FROM inventory_items i
 WHERE i.id = sm.inventory_item_id
   AND sm.unit_cost IS NULL;
