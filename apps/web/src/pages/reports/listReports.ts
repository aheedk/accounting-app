import { Decimal } from 'decimal.js';
import { sum, totalRow, type ReportColumn, type ReportRow, type ReportTable } from './standardReports';

// The standard reports read off the app's lists rather than the ledger (item
// 18, 10-27): the contact lists, the product list, estimates, open purchase
// orders, the invoice list and the collections report. Each takes the list as
// its endpoint returns it. Open balances come from the Open Invoices report, so
// they tie out to A/R Aging.

/** A date as the API sends it, cut to YYYY-MM-DD. */
const day = (value: string | null | undefined): string => (value ?? '').slice(0, 10);

const byName = <T extends { name: string }>(list: T[]): T[] => [...list].sort((a, b) => a.name.localeCompare(b.name));

const capitalized = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

type Address = { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null };

/** "12 Main St, Suite 4, Springfield, IL 62701, USA"; an address kept as plain text as it is. */
export function addressText(address: unknown): string {
  if (typeof address === 'string') return address.trim();
  if (!address || typeof address !== 'object') return '';
  const a = address as Address;
  const place = [a.city?.trim(), [a.state?.trim(), a.postal_code?.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [a.line1?.trim(), a.line2?.trim(), place, a.country?.trim()].filter(Boolean).join(', ');
}

/** A customer or vendor as its list endpoint returns it. */
export type Contact = {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  billing_address: unknown;
  shipping_address?: unknown;
  account_number?: string | null;
};

const phoneNumbers = (contact: Contact): string =>
  [contact.phone ? `Phone: ${contact.phone}` : '', contact.mobile ? `Mobile: ${contact.mobile}` : ''].filter(Boolean).join(', ');

const fullName = (contact: Contact): string => [contact.first_name, contact.last_name].filter(Boolean).join(' ');

/** Customer Contact List: each active customer's phone numbers, email, contact and addresses. */
export function customerContactListTable(customers: Contact[]): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Customer', kind: 'text' },
    { label: 'Phone Numbers', kind: 'text' },
    { label: 'Email', kind: 'text' },
    { label: 'Full Name', kind: 'text' },
    { label: 'Billing Address', kind: 'text' },
    { label: 'Shipping Address', kind: 'text' },
  ];
  const rows = byName(customers).map((c): ReportRow => ({
    kind: 'line', depth: 0, to: `/customers/${c.id}`,
    cells: [c.name, phoneNumbers(c), c.email ?? '', fullName(c), addressText(c.billing_address), addressText(c.shipping_address)],
  }));
  return { columns, rows };
}

/** Vendor Contact List: each active vendor's phone numbers, email, contact, address and the account number they know you by. */
export function vendorContactListTable(vendors: Contact[]): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Vendor', kind: 'text' },
    { label: 'Phone Numbers', kind: 'text' },
    { label: 'Email', kind: 'text' },
    { label: 'Full Name', kind: 'text' },
    { label: 'Address', kind: 'text' },
    { label: 'Account #', kind: 'text' },
  ];
  const rows = byName(vendors).map((v): ReportRow => ({
    kind: 'line', depth: 0, to: `/ap/vendors/${v.id}`,
    cells: [v.name, phoneNumbers(v), v.email ?? '', fullName(v), addressText(v.billing_address), v.account_number ?? ''],
  }));
  return { columns, rows };
}

/** An item as the inventory list returns it. */
export type Item = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  sale_price: string | null;
  purchase_cost: string | null;
  quantity_on_hand: string;
};

/** "12" for 12.0000, "2.5" for 2.5000. */
const quantity = (value: string | Decimal): string => new Decimal(value || '0').toString();

/** Product/Service List: every active item with its price, cost and the quantity on hand. */
export function productServiceListTable(items: Item[]): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Product/Service', kind: 'text' },
    { label: 'SKU', kind: 'text' },
    { label: 'Description', kind: 'text' },
    { label: 'Sales Price', kind: 'money' },
    { label: 'Cost', kind: 'money' },
    { label: 'Qty On Hand', kind: 'number' },
  ];
  const rows = byName(items).map((item): ReportRow => ({
    kind: 'line', depth: 0, to: `/inventory/items/${item.id}`,
    cells: [item.name, item.sku, item.description ?? '', item.sale_price ?? '', item.purchase_cost ?? '', quantity(item.quantity_on_hand)],
  }));
  return { columns, rows };
}

/** Rows under a heading per name, each with its own total, then the grand total. */
function grouped<T>(
  list: T[], nameOf: (entry: T) => string, rowOf: (entry: T) => ReportRow, totalsOf: (entries: T[]) => string[], width: number,
): ReportRow[] {
  const groups = new Map<string, T[]>();
  for (const entry of list) groups.set(nameOf(entry), [...(groups.get(nameOf(entry)) ?? []), entry]);
  const rows: ReportRow[] = [];
  for (const name of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    const own = groups.get(name)!;
    rows.push({ kind: 'heading', label: name, depth: 0 });
    for (const entry of own) rows.push(rowOf(entry));
    rows.push(totalRow(width, `Total for ${name}`, totalsOf(own)));
  }
  rows.push(totalRow(width, 'TOTAL', totalsOf(list)));
  return rows;
}

/** An estimate as its list endpoint returns it. */
export type EstimateRow = {
  id: string;
  estimate_number: string;
  customer_name: string;
  estimate_date: string;
  expiration_date: string | null;
  status: string;
  accepted_date: string | null;
  total: string;
};

/** Estimates by Customer: the estimates dated in the period, under each customer. */
export function estimatesByCustomerTable(estimates: EstimateRow[], range: { start: string; end: string }): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Num', kind: 'text' },
    { label: 'Status', kind: 'text' },
    { label: 'Accepted Date', kind: 'date' },
    { label: 'Expiration Date', kind: 'date' },
    { label: 'Amount', kind: 'money' },
  ];
  const inPeriod = estimates
    .filter(e => day(e.estimate_date) >= range.start && day(e.estimate_date) <= range.end)
    .sort((a, b) => day(a.estimate_date).localeCompare(day(b.estimate_date)));
  const rows = grouped(
    inPeriod,
    e => e.customer_name,
    (e): ReportRow => ({
      kind: 'line', depth: 1, to: `/estimates/${e.id}`,
      cells: [day(e.estimate_date), e.estimate_number, capitalized(e.status), day(e.accepted_date), day(e.expiration_date), e.total],
    }),
    list => [sum(list.map(e => e.total))],
    columns.length,
  );
  return { columns, rows };
}

/** A purchase order with its lines, as the purchase order endpoint returns it. */
export type PurchaseOrderRow = {
  id: string;
  po_number: string;
  vendor_id: string;
  order_date: string;
  expected_delivery_date: string | null;
  status: string;
  memo: string | null;
  lines: { quantity: string; unit_cost: string }[];
};

// Not yet received, closed or voided: a draft, or one sent to the vendor.
const OPEN_ORDER = new Set(['draft', 'sent']);
export const isOpenOrder = (order: { status: string }): boolean => OPEN_ORDER.has(order.status);

const orderAmount = (order: PurchaseOrderRow): string =>
  sum(order.lines.map(line => new Decimal(line.quantity || '0').times(line.unit_cost || '0').toFixed(4)));

/** Open Purchase Order List: the orders not yet received, closed or voided, under each vendor. */
export function openPurchaseOrderListTable(orders: PurchaseOrderRow[], vendorNames: ReadonlyMap<string, string>): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Num', kind: 'text' },
    { label: 'Status', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Expected Date', kind: 'date' },
    { label: 'Amount', kind: 'money' },
  ];
  const open = orders
    .filter(isOpenOrder)
    .sort((a, b) => day(a.order_date).localeCompare(day(b.order_date)));
  const rows = grouped(
    open,
    order => vendorNames.get(order.vendor_id) ?? 'Unknown vendor',
    (order): ReportRow => ({
      kind: 'line', depth: 1, to: `/inventory/purchase-orders/${order.id}`,
      cells: [day(order.order_date), order.po_number, capitalized(order.status), order.memo ?? '', day(order.expected_delivery_date), orderAmount(order)],
    }),
    list => [sum(list.map(orderAmount))],
    columns.length,
  );
  return { columns, rows };
}

/** An invoice as the invoice list returns it. */
export type InvoiceRow = {
  id: string;
  invoice_number: string;
  customer_id: string;
  issue_date: string;
  due_date: string;
  status: string;
  memo: string | null;
  total: string;
};

/**
 * Invoice List: every invoice dated in the period (not drafts), with what is
 * still owed on it. `openById` is the Open Invoices report's balance for each
 * invoice it lists; an invoice it does not list is paid.
 */
export function invoiceListTable(
  invoices: InvoiceRow[], customerNames: ReadonlyMap<string, string>, openById: ReadonlyMap<string, string>, range: { start: string; end: string },
): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Num', kind: 'text' },
    { label: 'Customer', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Due Date', kind: 'date' },
    { label: 'Status', kind: 'text' },
    { label: 'Amount', kind: 'money' },
    { label: 'Open Balance', kind: 'money' },
  ];
  const amounts: string[] = [];
  const balances: string[] = [];
  const rows = invoices
    .filter(i => i.status !== 'draft' && day(i.issue_date) >= range.start && day(i.issue_date) <= range.end)
    .sort((a, b) => day(a.issue_date).localeCompare(day(b.issue_date))
      || a.invoice_number.localeCompare(b.invoice_number, undefined, { numeric: true }))
    .map((i): ReportRow => {
      // A voided invoice is shown at nothing, as QuickBooks shows it.
      const voided = i.status === 'voided';
      const amount = voided ? '0.0000' : i.total;
      const open = voided ? '0.0000' : (openById.get(i.id) ?? '0.0000');
      const status = voided ? 'Voided'
        : new Decimal(open).isZero() ? 'Paid'
          : new Decimal(open).lessThan(i.total) ? 'Partially paid' : 'Open';
      amounts.push(amount);
      balances.push(open);
      return {
        kind: 'line', depth: 0, to: `/invoices/${i.id}`,
        cells: [day(i.issue_date), i.invoice_number, customerNames.get(i.customer_id) ?? '', i.memo ?? '', day(i.due_date), status, amount, open],
      };
    });
  rows.push(totalRow(columns.length, 'TOTAL', [sum(amounts), sum(balances)]));
  return { columns, rows };
}

/** An invoice still owed, as the Open Invoices report returns it. */
export type OpenInvoiceRow = {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  issue_date: string;
  due_date: string;
  total: string;
  open: string;
};

const dayNumber = (iso: string): number =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/**
 * Collections Report: the invoices past due as of the date, under each
 * customer with the phone number to call, and how many days late each is.
 */
export function collectionsReportTable(invoices: OpenInvoiceRow[], phones: ReadonlyMap<string, string>, asOf: string): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Num', kind: 'text' },
    { label: 'Due Date', kind: 'date' },
    { label: 'Past Due', kind: 'number' },
    { label: 'Amount', kind: 'money' },
    { label: 'Open Balance', kind: 'money' },
  ];
  const overdue = invoices
    .filter(i => day(i.due_date) < asOf && day(i.issue_date) <= asOf)
    .sort((a, b) => day(a.due_date).localeCompare(day(b.due_date)));
  const rows = grouped(
    overdue,
    i => (phones.get(i.customer_id) ? `${i.customer_name} (${phones.get(i.customer_id)})` : i.customer_name),
    (i): ReportRow => ({
      kind: 'line', depth: 1, to: `/invoices/${i.id}`,
      cells: [day(i.issue_date), i.invoice_number, day(i.due_date), String(dayNumber(asOf) - dayNumber(day(i.due_date))), i.total, i.open],
    }),
    list => [sum(list.map(i => i.total)), sum(list.map(i => i.open))],
    columns.length,
  );
  return { columns, rows };
}

/** An item's stock as the Inventory Valuation endpoint returns it. */
export type ValuationItem = {
  item_id: string;
  sku: string;
  name: string;
  quantity: string;
  value: string;
  opening_quantity: string;
  opening_value: string;
  movements: {
    id: string;
    movement_date: string;
    reason: string;
    memo: string | null;
    quantity: string;
    unit_cost: string | null;
    value: string;
  }[];
};

/** Inventory Valuation Summary: each item's quantity on hand as of the date, what it cost, and the average. */
export function inventoryValuationSummaryTable(items: ValuationItem[]): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Product/Service', kind: 'text' },
    { label: 'SKU', kind: 'text' },
    { label: 'Qty', kind: 'number' },
    { label: 'Asset Value', kind: 'money' },
    { label: 'Calc. Avg', kind: 'money' },
  ];
  const rows = byName(items).map((item): ReportRow => {
    const onHand = new Decimal(item.quantity || '0');
    return {
      kind: 'line', depth: 0, to: `/inventory/items/${item.item_id}`,
      cells: [item.name, item.sku, quantity(onHand), item.value, onHand.isZero() ? '' : new Decimal(item.value).dividedBy(onHand).toFixed(4)],
    };
  });
  rows.push(totalRow(columns.length, 'TOTAL', [quantity(sum(items.map(item => item.quantity))), sum(items.map(item => item.value)), '']));
  return { columns, rows };
}

const MOVEMENT_TYPES: Record<string, string> = {
  opening_balance: 'Opening Inventory',
  manual_in: 'Stock In',
  manual_out: 'Stock Out',
  adjustment: 'Inventory Qty Adjust',
  write_off: 'Write-off',
};

/**
 * Inventory Valuation Detail: each item from where it stood at the start of
 * the period, through every movement, with the quantity and value running.
 */
export function inventoryValuationDetailTable(items: ValuationItem[]): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Transaction Type', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Qty', kind: 'number' },
    { label: 'Rate', kind: 'money' },
    { label: 'Value', kind: 'money' },
    { label: 'Qty On Hand', kind: 'number' },
    { label: 'Asset Value', kind: 'money' },
  ];
  const width = columns.length;
  const rows: ReportRow[] = [];
  const shown = byName(items).filter(item => item.movements.length > 0
    || !new Decimal(item.opening_quantity || '0').isZero() || !new Decimal(item.opening_value || '0').isZero());
  for (const item of shown) {
    rows.push({ kind: 'heading', label: item.name, depth: 0 });
    rows.push({ kind: 'line', depth: 1, cells: ['Beginning Balance', '', '', '', '', '', quantity(item.opening_quantity), item.opening_value] });
    let onHand = new Decimal(item.opening_quantity || '0');
    let value = new Decimal(item.opening_value || '0');
    for (const movement of item.movements) {
      onHand = onHand.plus(movement.quantity);
      value = value.plus(movement.value);
      rows.push({
        kind: 'line', depth: 1, to: `/inventory/items/${item.item_id}`,
        cells: [
          day(movement.movement_date), MOVEMENT_TYPES[movement.reason] ?? capitalized(movement.reason), movement.memo ?? '',
          quantity(movement.quantity), movement.unit_cost ?? '', movement.value, quantity(onHand), value.toFixed(4),
        ],
      });
    }
    rows.push(totalRow(width, `Total for ${item.name}`, [
      quantity(onHand.minus(item.opening_quantity || '0')), '', value.minus(item.opening_value || '0').toFixed(4), quantity(onHand), value.toFixed(4),
    ]));
  }
  rows.push(totalRow(width, 'TOTAL', [sum(shown.map(item => item.value))]));
  return { columns, rows };
}
