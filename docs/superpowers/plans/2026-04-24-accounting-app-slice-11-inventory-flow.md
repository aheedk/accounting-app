# Slice 11 — Inventory Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace 5 Inventory ComingSoon stubs (Inventory Overview, Purchase Orders, Item Receipts, Sales Orders, Shipping Labels) with real workflow features.

**Architecture:**
- **PO → Item Receipt → Bill (simplified — no full 3-way match):** PO is informational. Item Receipt creates the Bill via existing `billService.createDraft` + `postBill`, increments `inventory_items.quantity_on_hand`, and posts a `stock_movement` row.
- **SO → Fulfill → Invoice:** SO is informational. "Fulfill" creates the Invoice (`invoiceService.createDraft` + `post`), decrements stock via `stockMovementService`.
- **Shipping Labels:** manual entry linked to an Invoice. Optional file upload via slice-10's `fileStorage`. No carrier API.
- **Inventory Overview:** read-only KPI dashboard.

**Tech Stack:** No new deps.

---

## Locked decisions

1. **No 3-way match.** PO is a record-keeping commitment. Item Receipt creates a Bill directly (DR Inventory / CR AP through `billService`).
2. **PO + SO use auto-incrementing numbers** scoped per business: `po_number`, `so_number`. Implement via a per-business sequence helper (existing pattern: see how `bill_number` and `invoice_number` are generated).
3. **Stock movement on Item Receipt:** `movement_type='purchase'`, qty positive. On SO Fulfill: `movement_type='sale'`, qty negative.
4. **Reverse pre-existing inventory line items:** the `bills.lines` and `invoices.lines` already exist via the line-item tables. Item Receipt builds bill lines from PO lines: one line per PO line at unit_cost. SO Fulfill builds invoice lines from SO lines.
5. **Shipping Labels do NOT post to ledger.** They're metadata only. The shipping cost is recorded against the existing carrier-cost expense via the user's choice of payment account.
6. **Plan-impl sync.**

---

## Phase A — Infra + DB

### Task 1: Migration `0037_purchase_orders.sql`

```sql
CREATE TYPE purchase_order_status AS ENUM ('draft', 'sent', 'received', 'closed', 'void');

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  po_number text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  order_date date NOT NULL,
  expected_delivery_date date,
  status purchase_order_status NOT NULL DEFAULT 'draft',
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT po_unique_number UNIQUE (business_id, po_number)
);
CREATE INDEX idx_po_business ON purchase_orders(business_id);
CREATE INDEX idx_po_vendor ON purchase_orders(vendor_id);
CREATE TRIGGER purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  description text,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(19,4) NOT NULL CHECK (unit_cost >= 0),
  CONSTRAINT pol_unique_line_number UNIQUE (purchase_order_id, line_number)
);
CREATE INDEX idx_pol_po ON purchase_order_lines(purchase_order_id);
```

Commit: `feat(db): purchase_orders + purchase_order_lines`.

### Task 2: Migration `0038_item_receipts.sql`

```sql
CREATE TABLE item_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
  receipt_date date NOT NULL,
  bill_id uuid REFERENCES bills(id),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id)
);
CREATE INDEX idx_ir_business ON item_receipts(business_id);
CREATE INDEX idx_ir_po ON item_receipts(purchase_order_id);
CREATE TRIGGER item_receipts_updated_at BEFORE UPDATE ON item_receipts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Commit: `feat(db): item_receipts`.

### Task 3: Migration `0039_sales_orders.sql`

```sql
CREATE TYPE sales_order_status AS ENUM ('draft', 'confirmed', 'fulfilled', 'void');

CREATE TABLE sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  so_number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  order_date date NOT NULL,
  status sales_order_status NOT NULL DEFAULT 'draft',
  invoice_id uuid REFERENCES invoices(id),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT so_unique_number UNIQUE (business_id, so_number)
);
CREATE INDEX idx_so_business ON sales_orders(business_id);
CREATE INDEX idx_so_customer ON sales_orders(customer_id);
CREATE TRIGGER sales_orders_updated_at BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sales_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  description text,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  CONSTRAINT sol_unique_line_number UNIQUE (sales_order_id, line_number)
);
CREATE INDEX idx_sol_so ON sales_order_lines(sales_order_id);
```

Commit: `feat(db): sales_orders + sales_order_lines`.

### Task 4: Migration `0040_shipping_labels.sql`

```sql
CREATE TABLE shipping_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  invoice_id uuid REFERENCES invoices(id),
  sales_order_id uuid REFERENCES sales_orders(id),
  carrier text NOT NULL,
  tracking_number text NOT NULL,
  shipped_at date NOT NULL,
  cost numeric(19,4),
  label_file_id uuid REFERENCES files(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT sl_link_required CHECK (invoice_id IS NOT NULL OR sales_order_id IS NOT NULL)
);
CREATE INDEX idx_sl_business ON shipping_labels(business_id);
CREATE INDEX idx_sl_invoice ON shipping_labels(invoice_id);
CREATE INDEX idx_sl_so ON shipping_labels(sales_order_id);
CREATE TRIGGER shipping_labels_updated_at BEFORE UPDATE ON shipping_labels FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Commit: `feat(db): shipping_labels`.

### Task 5: DB types + audit + schemas + factories + truncateAll

**DB type augmentations** (full interfaces for all 5 new tables).

**Audit actions:**
```ts
PURCHASE_ORDER_CREATE: 'purchase_order.create',
PURCHASE_ORDER_UPDATE: 'purchase_order.update',
PURCHASE_ORDER_VOID: 'purchase_order.void',
ITEM_RECEIPT_CREATE: 'item_receipt.create',
SALES_ORDER_CREATE: 'sales_order.create',
SALES_ORDER_UPDATE: 'sales_order.update',
SALES_ORDER_FULFILL: 'sales_order.fulfill',
SALES_ORDER_VOID: 'sales_order.void',
SHIPPING_LABEL_CREATE: 'shipping_label.create',
SHIPPING_LABEL_UPDATE: 'shipping_label.update',
SHIPPING_LABEL_DELETE: 'shipping_label.delete',
```

**Zod schemas:** `purchaseOrder.ts`, `itemReceipt.ts`, `salesOrder.ts`, `shippingLabel.ts`. Re-export.

**Factories:** `makePurchaseOrder`, `makeSalesOrder`, `makeShippingLabel` (the line tables can be inserted ad-hoc in tests).

**truncateAll prepend:** `'shipping_labels', 'sales_order_lines', 'sales_orders', 'item_receipts', 'purchase_order_lines', 'purchase_orders'`.

Commit: `feat(shared,api): slice 11 audit, schemas, factories, types, truncateAll`.

---

## Phase B — Services (parallel)

### Task 6: `purchaseOrderService.ts` (TDD, 2 tests)
- `createPO(trx, ctx, { business_id, vendor_id, order_date, lines })` — assigns next po_number, inserts PO + lines, audit.
- `updatePO`, `voidPO`, `listPOs`, `getPO`.
- Tests: create + auto-numbering; void blocks if any item_receipt exists.

### Task 7: `itemReceiptService.ts` (TDD, 3 tests)
- `createReceipt(trx, ctx, { business_id, po_id, receipt_date, line_quantities? })` — fetches PO + lines, builds Bill via `billService.createDraft` + `postBill`, increments stock via `stockMovementService.create({ movement_type: 'purchase', ... })`, links receipt → bill, sets PO status to 'received'.
- Tests: create posts bill + stock; PO status transitions to received; rejects if PO is void.

### Task 8: `salesOrderService.ts` (TDD, 3 tests)
- `createSO`, `updateSO`, `voidSO`.
- `fulfill(trx, ctx, { so_id })` — creates Invoice via `invoiceService.createDraft` + `post`, decrements stock, sets SO status to 'fulfilled'.
- Tests: create + auto-numbering; fulfill creates invoice + stock decrement; rejects if insufficient stock (optional safeguard).

### Task 9: `shippingLabelService.ts` (TDD, 1 test)
- `createLabel(trx, ctx, { business_id, invoice_id?, sales_order_id?, carrier, tracking_number, shipped_at, cost?, label_file_id? })`.
- `listLabels`, `deleteLabel`.

### Task 10: `inventoryOverviewService.ts` (TDD, 1 test)
Read-only. Returns:
- total_items_count
- total_stock_value (sum quantity_on_hand × cost)
- low_stock_items (where quantity_on_hand <= reorder_point — verify column name in `inventory_items` table; may not exist in slice-7 schema, in which case skip this metric or default to 0)
- recent_receipts (last 5)
- recent_sales (last 5 fulfilled SOs)

---

## Phase C — Routes (parallel)

### Task 11: `purchaseOrders.ts` + `itemReceipts.ts` routes
### Task 12: `salesOrders.ts` route
### Task 13: `shippingLabels.ts` + `inventoryOverview.ts` routes

Wire all in `app.ts`.

---

## Phase D — Web (parallel)

### Task 14: `InventoryOverviewPage.tsx`
KPI cards + recent activity tables.

### Task 15: `PurchaseOrderListPage` + `New` + `Detail`
PO CRUD UI with line editor.

### Task 16: `ItemReceiptListPage` + `New` (from PO)
Pick a PO, confirm quantities, "Receive" creates the bill + stock.

### Task 17: `SalesOrderListPage` + `New` + `Detail` (with Fulfill button)

### Task 18: `ShippingLabelListPage` + `New`
Manual entry form, optional file upload.

### Task 19 (SOLO): Wire all 5 routes in `App.tsx`

---

## Phase E — Merge + deploy

Standard: merge slice 11 into main, push. Migrations 0037-0040 auto-run. No env-var prereqs.

---

## Definition of Done

- 5 ComingSoon stubs in `/inventory/*` replaced.
- Migrations 0037-0040 applied.
- ~10 new tests (slice 10 baseline 132 → ≥142).
- An Item Receipt against a PO posts a Bill + stock_movement; verifiable in audit logs.
- An SO Fulfill posts an Invoice + stock_movement.
