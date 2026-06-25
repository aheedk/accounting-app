-- Demo Inventory / order management: purchase orders (+lines), item receipts
-- with stock movements, sales orders (+lines) and shipping labels. These are
-- operational records (no journal entries). Idempotent per business.
DO $$
DECLARE
  r record;
  v_user uuid;
  v_vends uuid[];
  v_custs uuid[];
  v_items uuid[];
  v_inv_ids uuid[];
  v_po uuid; v_so uuid; v_recv uuid;
  v_vend uuid; v_cust uuid; v_item uuid;
  v_date date;
  v_po_status text; v_so_status text;
  v_carriers text[] := ARRAY['UPS','FedEx','USPS','DHL'];
  i int; j int; v_qty int; v_cost numeric; v_price numeric;
BEGIN
  SELECT id INTO v_user FROM users WHERE email = 'admin@example.com' LIMIT 1;

  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF EXISTS (SELECT 1 FROM purchase_orders WHERE business_id = r.id AND po_number LIKE 'PO-3%') THEN
      CONTINUE;
    END IF;

    SELECT array_agg(id ORDER BY created_at) INTO v_vends FROM vendors WHERE business_id = r.id;
    SELECT array_agg(id ORDER BY created_at) INTO v_custs FROM customers WHERE business_id = r.id;
    SELECT array_agg(id ORDER BY sku) INTO v_items FROM inventory_items WHERE business_id = r.id AND sku <> 'SVC-900';
    SELECT array_agg(id ORDER BY invoice_number) INTO v_inv_ids FROM invoices WHERE business_id = r.id AND invoice_number LIKE 'INV-1%';

    -- 6 purchase orders with varied statuses.
    FOR i IN 1..6 LOOP
      v_vend := v_vends[1 + (i % array_length(v_vends, 1))];
      v_date := make_date(2026, 1 + (i % 6), 3 + (i * 3) % 24);
      v_po_status := (ARRAY['sent','received','received','closed','draft','sent'])[i];
      v_po := gen_random_uuid();

      INSERT INTO purchase_orders (id, business_id, po_number, vendor_id, order_date,
                                   expected_delivery_date, status, memo, created_by_user_id)
      VALUES (v_po, r.id, 'PO-' || (3000 + i), v_vend, v_date, v_date + 14, v_po_status::purchase_order_status,
              'Stock replenishment', v_user);

      -- 2 lines per PO.
      FOR j IN 1..2 LOOP
        v_item := v_items[1 + ((i + j) % array_length(v_items, 1))];
        v_qty := 20 * j + i;
        SELECT purchase_cost INTO v_cost FROM inventory_items WHERE id = v_item;
        INSERT INTO purchase_order_lines (purchase_order_id, line_number, inventory_item_id, description,
                                          quantity, unit_cost)
        VALUES (v_po, j, v_item, 'Replenishment', v_qty, COALESCE(v_cost, 1));
      END LOOP;

      -- Received/closed POs get an item receipt + stock-in movements.
      IF v_po_status IN ('received', 'closed') THEN
        v_recv := gen_random_uuid();
        INSERT INTO item_receipts (id, business_id, purchase_order_id, receipt_date, memo, created_by_user_id)
        VALUES (v_recv, r.id, v_po, v_date + 10, 'Goods received', v_user);
        INSERT INTO stock_movements (inventory_item_id, movement_date, quantity_delta, reason, memo, posted_by_user_id)
        SELECT pol.inventory_item_id, v_date + 10, pol.quantity, 'manual_in', 'PO receipt', v_user
          FROM purchase_order_lines pol WHERE pol.purchase_order_id = v_po;
      END IF;
    END LOOP;

    -- 6 sales orders with varied statuses.
    FOR i IN 1..6 LOOP
      v_cust := v_custs[1 + (i % array_length(v_custs, 1))];
      v_date := make_date(2026, 1 + (i % 6), 6 + (i * 3) % 20);
      v_so_status := (ARRAY['confirmed','fulfilled','fulfilled','draft','confirmed','fulfilled'])[i];
      v_so := gen_random_uuid();

      INSERT INTO sales_orders (id, business_id, so_number, customer_id, order_date, status, memo, created_by_user_id)
      VALUES (v_so, r.id, 'SO-' || (4000 + i), v_cust, v_date, v_so_status::sales_order_status,
              'Customer order', v_user);

      FOR j IN 1..2 LOOP
        v_item := v_items[1 + ((i * 2 + j) % array_length(v_items, 1))];
        v_qty := 5 * j + i;
        SELECT sale_price INTO v_price FROM inventory_items WHERE id = v_item;
        INSERT INTO sales_order_lines (sales_order_id, line_number, inventory_item_id, description,
                                       quantity, unit_price)
        VALUES (v_so, j, v_item, 'Customer order line', v_qty, COALESCE(v_price, 1));
      END LOOP;

      -- Fulfilled SOs ship out with a label and stock-out movements.
      IF v_so_status = 'fulfilled' THEN
        INSERT INTO shipping_labels (business_id, sales_order_id, carrier, tracking_number, shipped_at, cost, notes, created_by_user_id)
        VALUES (r.id, v_so, v_carriers[1 + (i % 4)], '1Z' || lpad((900000 + i * 37)::text, 8, '0'),
                v_date + 3, 12.50 + i, 'Fulfillment shipment', v_user);
        INSERT INTO stock_movements (inventory_item_id, movement_date, quantity_delta, reason, memo, posted_by_user_id)
        SELECT sol.inventory_item_id, v_date + 3, -sol.quantity, 'manual_out', 'SO fulfillment', v_user
          FROM sales_order_lines sol WHERE sol.sales_order_id = v_so;
      END IF;
    END LOOP;

    -- A couple of shipping labels tied directly to invoices.
    IF v_inv_ids IS NOT NULL AND array_length(v_inv_ids, 1) >= 2 THEN
      FOR i IN 1..2 LOOP
        INSERT INTO shipping_labels (business_id, invoice_id, carrier, tracking_number, shipped_at, cost, notes, created_by_user_id)
        VALUES (r.id, v_inv_ids[i], v_carriers[i], '1Z' || lpad((700000 + i * 53)::text, 8, '0'),
                make_date(2026, 4, 10 + i), 9.75 + i, 'Invoice shipment', v_user);
      END LOOP;
    END IF;

  END LOOP;
END $$;
