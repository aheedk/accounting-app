import { describe, expect, it } from 'vitest';
import { buildInvoicePdf, invoiceTotalsRows, type InvoicePdfInput } from './invoicePdf';

const invoice: InvoicePdfInput = {
  companyName: 'Green Gadgets Inc.',
  companyAddressLines: ['100 Main Street', 'Springfield, IL 62701'],
  customerName: 'Tailspin Toys',
  invoiceNumber: '1042',
  issueDate: 'October 7, 2026',
  dueDate: 'November 21, 2026',
  terms: 'Net 45',
  status: 'posted',
  lines: [
    { description: 'Consulting', quantity: '2.0000', unitPrice: '150.0000', amount: '300.0000' },
    { description: 'Travel', quantity: '1.0000', unitPrice: '89.5000', amount: '89.5000' },
  ],
  subtotal: '389.5000', taxTotal: '0', total: '389.5000', paid: '0', balanceDue: '389.5000',
  memo: 'Thank you for your business.',
};

// 2026-09-28 audit: an invoice could not be saved as a PDF.
describe('invoice PDF', () => {
  it('lists subtotal, total and balance due, and tax or payments only when there are some', () => {
    expect(invoiceTotalsRows(invoice)).toEqual([
      ['Subtotal', '389.50'], ['Total', '389.50'], ['Balance due', '389.50'],
    ]);
    expect(invoiceTotalsRows({ subtotal: '1000', taxTotal: '80', total: '1080', paid: '500', balanceDue: '580' })).toEqual([
      ['Subtotal', '1,000.00'], ['Tax', '80.00'], ['Total', '1,080.00'],
      ['Payments and credits', '-500.00'], ['Balance due', '580.00'],
    ]);
  });

  it('builds a one-page document carrying the invoice number, customer and lines', () => {
    const doc = buildInvoicePdf(invoice);
    expect(doc.getNumberOfPages()).toBe(1);
    const text = doc.output();
    for (const expected of ['INVOICE', 'Green Gadgets Inc.', 'Tailspin Toys', '1042', 'Consulting', 'Net 45', 'Balance due']) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('VOIDED');
    expect(buildInvoicePdf({ ...invoice, status: 'voided' }).output()).toContain('VOIDED');
  });
});
