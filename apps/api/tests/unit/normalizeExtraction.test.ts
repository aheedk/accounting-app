import { describe, it, expect } from 'vitest';
import { normalizeExtraction } from '../../src/jobs/gmailWorker.js';

describe('normalizeExtraction', () => {
  it('stages a customer purchase order with the invoices, as kind po', () => {
    const out = normalizeExtraction({ document_type: 'purchase_order', vendor_customer: 'Blue Widget', invoice_number: 'PO-7781' });
    expect(out).toMatchObject({ document_type: 'invoice', invoice_type: 'po', vendor_customer: 'Blue Widget', invoice_number: 'PO-7781' });
  });

  it('leaves every other document as the model returned it', () => {
    expect(normalizeExtraction({ document_type: 'invoice', invoice_type: 'ar' })).toEqual({ document_type: 'invoice', invoice_type: 'ar' });
    expect(normalizeExtraction({ document_type: 'unknown' })).toEqual({ document_type: 'unknown' });
  });
});
