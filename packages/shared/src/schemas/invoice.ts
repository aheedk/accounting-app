import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be non-negative decimal, up to 4dp');

export const invoiceLineInputSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: money,
  unit_price: money,
  revenue_account_id: z.string().uuid(),
  tax_code_id: z.string().uuid().nullable().optional(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

export const invoiceDraftCreateSchema = z.object({
  customer_id: z.string().uuid(),
  invoice_number: z.string().min(1).max(60),
  issue_date: dateString,
  due_date: dateString,
  memo: z.string().max(1000).nullable().optional(),
  terms: z.string().max(200).nullable().optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type InvoiceDraftCreate = z.infer<typeof invoiceDraftCreateSchema>;

export const invoiceVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
