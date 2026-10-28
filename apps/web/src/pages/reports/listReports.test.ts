import { describe, expect, it } from 'vitest';
import {
  addressText, collectionsReportTable, customerContactListTable, estimatesByCustomerTable, inventoryValuationDetailTable,
  inventoryValuationSummaryTable, invoiceListTable, openPurchaseOrderListTable, productServiceListTable, vendorContactListTable,
  type Contact, type EstimateRow, type InvoiceRow, type OpenInvoiceRow, type PurchaseOrderRow, type ValuationItem,
} from './listReports';
import type { ReportRow } from './standardReports';

const cells = (rows: ReportRow[]): string[][] => rows.map(r => (r.kind === 'heading' ? [`# ${r.label}`] : r.cells));

function contact(id: string, name: string, overrides: Partial<Contact> = {}): Contact {
  return { id, name, first_name: null, last_name: null, email: null, phone: null, mobile: null, billing_address: null, ...overrides };
}

describe('addressText', () => {
  it('writes an address on one line, leaving out what is missing', () => {
    expect(addressText({ line1: '12 Main St', line2: '', city: 'Springfield', state: 'IL', postal_code: '62701', country: 'USA' }))
      .toBe('12 Main St, Springfield, IL 62701, USA');
    expect(addressText({ city: 'Austin', state: 'TX' })).toBe('Austin, TX');
  });

  it('takes an address kept as text as it is, and nothing as blank', () => {
    expect(addressText(' 4 Elm Rd ')).toBe('4 Elm Rd');
    expect(addressText(null)).toBe('');
  });
});

describe('contact lists', () => {
  it('lists customers by name with their phone numbers, contact and addresses', () => {
    const { rows } = customerContactListTable([
      contact('c2', 'Zephyr Co'),
      contact('c1', 'Acme', {
        first_name: 'Ana', last_name: 'Ruiz', email: 'ana@acme.test', phone: '555-0100', mobile: '555-0199',
        billing_address: { line1: '1 Way', city: 'Reno', state: 'NV' }, shipping_address: { line1: '2 Dock', city: 'Reno', state: 'NV' },
      }),
    ]);
    expect(cells(rows)).toEqual([
      ['Acme', 'Phone: 555-0100, Mobile: 555-0199', 'ana@acme.test', 'Ana Ruiz', '1 Way, Reno, NV', '2 Dock, Reno, NV'],
      ['Zephyr Co', '', '', '', '', ''],
    ]);
    expect(rows[0]).toMatchObject({ to: '/customers/c1' });
  });

  it('gives a vendor the account number they know you by', () => {
    const { rows } = vendorContactListTable([contact('v1', 'Staples', { phone: '555-0123', account_number: 'AC-77' })]);
    expect(cells(rows)).toEqual([['Staples', 'Phone: 555-0123', '', '', '', 'AC-77']]);
    expect(rows[0]).toMatchObject({ to: '/ap/vendors/v1' });
  });
});

describe('productServiceListTable', () => {
  it('lists items by name with the quantity on hand as a plain number', () => {
    const { rows } = productServiceListTable([
      { id: 'i2', sku: 'W-2', name: 'Widget', description: 'Blue', sale_price: '12.5000', purchase_cost: '7.0000', quantity_on_hand: '12.0000' },
      { id: 'i1', sku: 'G-1', name: 'Gadget', description: null, sale_price: null, purchase_cost: null, quantity_on_hand: '2.5000' },
    ]);
    expect(cells(rows)).toEqual([
      ['Gadget', 'G-1', '', '', '', '2.5'],
      ['Widget', 'W-2', 'Blue', '12.5000', '7.0000', '12'],
    ]);
  });
});

describe('estimatesByCustomerTable', () => {
  const estimate = (id: string, customer: string, date: string, total: string, overrides: Partial<EstimateRow> = {}): EstimateRow => ({
    id, estimate_number: id.toUpperCase(), customer_name: customer, estimate_date: date, expiration_date: null,
    status: 'pending', accepted_date: null, total, ...overrides,
  });

  it('lists the estimates dated in the period under each customer, with totals', () => {
    const { rows } = estimatesByCustomerTable([
      estimate('e3', 'Birch', '2026-03-20', '30.0000'),
      estimate('e1', 'Acme', '2026-03-02T00:00:00.000Z', '100.0000', { status: 'accepted', accepted_date: '2026-03-04', expiration_date: '2026-04-01' }),
      estimate('e2', 'Acme', '2026-02-27', '999.0000'),
    ], { start: '2026-03-01', end: '2026-03-31' });
    expect(cells(rows)).toEqual([
      ['# Acme'],
      ['2026-03-02', 'E1', 'Accepted', '2026-03-04', '2026-04-01', '100.0000'],
      ['Total for Acme', '', '', '', '', '100.0000'],
      ['# Birch'],
      ['2026-03-20', 'E3', 'Pending', '', '', '30.0000'],
      ['Total for Birch', '', '', '', '', '30.0000'],
      ['TOTAL', '', '', '', '', '130.0000'],
    ]);
  });
});

describe('openPurchaseOrderListTable', () => {
  const order = (id: string, vendor: string, status: string, lines: PurchaseOrderRow['lines']): PurchaseOrderRow => ({
    id, po_number: id.toUpperCase(), vendor_id: vendor, order_date: '2026-03-05', expected_delivery_date: null, status, memo: null, lines,
  });

  it('lists drafts and sent orders under their vendor, priced from their lines', () => {
    const { rows } = openPurchaseOrderListTable([
      order('po1', 'v1', 'sent', [{ quantity: '3.0000', unit_cost: '2.5000' }, { quantity: '1.0000', unit_cost: '10.0000' }]),
      order('po2', 'v1', 'received', [{ quantity: '9.0000', unit_cost: '9.0000' }]),
      order('po3', 'gone', 'draft', [{ quantity: '2.0000', unit_cost: '4.0000' }]),
    ], new Map([['v1', 'Staples']]));
    expect(cells(rows)).toEqual([
      ['# Staples'],
      ['2026-03-05', 'PO1', 'Sent', '', '', '17.5000'],
      ['Total for Staples', '', '', '', '', '17.5000'],
      ['# Unknown vendor'],
      ['2026-03-05', 'PO3', 'Draft', '', '', '8.0000'],
      ['Total for Unknown vendor', '', '', '', '', '8.0000'],
      ['TOTAL', '', '', '', '', '25.5000'],
    ]);
  });
});

describe('invoiceListTable', () => {
  const invoice = (id: string, date: string, status: string, total: string): InvoiceRow => ({
    id, invoice_number: id.replace('i', '10'), customer_id: 'c1', issue_date: date, due_date: '2026-04-01', status, memo: null, total,
  });

  it('lists the period\'s invoices with what is still owed, a voided one at nothing, and no drafts', () => {
    const { rows } = invoiceListTable([
      invoice('i4', '2026-03-09', 'voided', '40.0000'),
      invoice('i3', '2026-03-08', 'posted', '30.0000'),
      invoice('i2', '2026-03-05', 'posted', '20.0000'),
      invoice('i1', '2026-03-02', 'paid', '10.0000'),
      invoice('i5', '2026-03-10', 'draft', '50.0000'),
      invoice('i0', '2026-02-20', 'posted', '60.0000'),
    ], new Map([['c1', 'Acme']]), new Map([['i2', '5.0000'], ['i3', '30.0000']]), { start: '2026-03-01', end: '2026-03-31' });
    expect(cells(rows).map(row => [row[1], row[5], row[6], row[7]])).toEqual([
      ['101', 'Paid', '10.0000', '0.0000'],
      ['102', 'Partially paid', '20.0000', '5.0000'],
      ['103', 'Open', '30.0000', '30.0000'],
      ['104', 'Voided', '0.0000', '0.0000'],
      ['', '', '60.0000', '35.0000'],
    ]);
    expect(rows[0]).toMatchObject({ to: '/invoices/i1', cells: ['2026-03-02', '101', 'Acme', '', '2026-04-01', 'Paid', '10.0000', '0.0000'] });
  });
});

describe('collectionsReportTable', () => {
  const open = (id: string, customer: string, due: string, amount: string, owed: string): OpenInvoiceRow => ({
    id, invoice_number: id.toUpperCase(), customer_id: customer, customer_name: customer === 'c1' ? 'Acme' : 'Birch',
    issue_date: '2026-02-01', due_date: due, total: amount, open: owed,
  });

  it('lists what is past due under each customer, with their phone and the days late', () => {
    const { rows } = collectionsReportTable([
      open('inv2', 'c2', '2026-03-25', '80.0000', '80.0000'),
      open('inv1', 'c1', '2026-03-01', '100.0000', '40.0000'),
      open('inv3', 'c1', '2026-04-15', '50.0000', '50.0000'),
    ], new Map([['c1', '555-0100']]), '2026-03-31');
    expect(cells(rows)).toEqual([
      ['# Acme (555-0100)'],
      ['2026-02-01', 'INV1', '2026-03-01', '30', '100.0000', '40.0000'],
      ['Total for Acme (555-0100)', '', '', '', '100.0000', '40.0000'],
      ['# Birch'],
      ['2026-02-01', 'INV2', '2026-03-25', '6', '80.0000', '80.0000'],
      ['Total for Birch', '', '', '', '80.0000', '80.0000'],
      ['TOTAL', '', '', '', '180.0000', '120.0000'],
    ]);
  });
});

describe('inventory valuation', () => {
  const widget: ValuationItem = {
    item_id: 'w', sku: 'W-1', name: 'Widget', quantity: '12.0000', value: '66.0000', opening_quantity: '10.0000', opening_value: '50.0000',
    movements: [
      { id: 'm1', movement_date: '2026-02-10', reason: 'manual_out', memo: 'Fulfillment of SO-1', quantity: '-4.0000', unit_cost: '5.0000', value: '-20.0000' },
      { id: 'm2', movement_date: '2026-03-15', reason: 'manual_in', memo: 'Item receipt for PO-1', quantity: '6.0000', unit_cost: '6.0000', value: '36.0000' },
    ],
  };
  const gadget: ValuationItem = {
    item_id: 'g', sku: 'G-1', name: 'Gadget', quantity: '0.0000', value: '0.0000', opening_quantity: '0.0000', opening_value: '0.0000', movements: [],
  };

  it('sums each item up as of the date, with the average cost', () => {
    expect(cells(inventoryValuationSummaryTable([widget, gadget]).rows)).toEqual([
      ['Gadget', 'G-1', '0', '0.0000', ''],
      ['Widget', 'W-1', '12', '66.0000', '5.5000'],
      ['TOTAL', '', '12', '66.0000', ''],
    ]);
  });

  it('runs each item from where it stood through every movement, and leaves out one that never moved', () => {
    expect(cells(inventoryValuationDetailTable([widget, gadget]).rows)).toEqual([
      ['# Widget'],
      ['Beginning Balance', '', '', '', '', '', '10', '50.0000'],
      ['2026-02-10', 'Stock Out', 'Fulfillment of SO-1', '-4', '5.0000', '-20.0000', '6', '30.0000'],
      ['2026-03-15', 'Stock In', 'Item receipt for PO-1', '6', '6.0000', '36.0000', '12', '66.0000'],
      ['Total for Widget', '', '', '2', '', '16.0000', '12', '66.0000'],
      ['TOTAL', '', '', '', '', '', '', '66.0000'],
    ]);
  });
});
