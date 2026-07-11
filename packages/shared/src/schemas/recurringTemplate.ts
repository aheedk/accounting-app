import { z } from 'zod';
import { invoiceLineInputSchema } from './invoice.js';
import { billLineCreateSchema } from './bill.js';

// Type-specific payload shapes. Dates and document numbers are per-run
// (assigned at materialization), so payloads carry neither.
export const recurringJePayloadSchema = z.object({
  memo: z.string().max(1000).nullable().optional(),
  reference: z.string().max(200).nullable().optional(),
  lines: z.array(z.object({
    account_id: z.string().uuid(),
    debit: z.string().regex(/^\d+(\.\d{1,4})?$/),
    credit: z.string().regex(/^\d+(\.\d{1,4})?$/),
    memo: z.string().max(500).nullable().optional(),
  })).min(2),
});
export type RecurringJePayload = z.infer<typeof recurringJePayloadSchema>;

export const recurringInvoicePayloadSchema = z.object({
  customer_id: z.string().uuid(),
  due_days: z.number().int().min(0).max(365).default(30),
  memo: z.string().max(1000).nullable().optional(),
  terms: z.string().max(200).nullable().optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type RecurringInvoicePayload = z.infer<typeof recurringInvoicePayloadSchema>;

export const recurringBillPayloadSchema = z.object({
  vendor_id: z.string().uuid(),
  due_days: z.number().int().min(0).max(365).default(30),
  memo: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  lines: z.array(billLineCreateSchema).min(1),
});
export type RecurringBillPayload = z.infer<typeof recurringBillPayloadSchema>;

export const recurringTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  template_type: z.enum(['journal_entry', 'invoice', 'bill']),
  payload: z.record(z.unknown()),
  recurrence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type RecurringTemplateCreate = z.infer<typeof recurringTemplateCreateSchema>;

export const recurringTemplateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  payload: z.record(z.unknown()).optional(),
  recurrence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_active: z.boolean().optional(),
});
export type RecurringTemplateUpdate = z.infer<typeof recurringTemplateUpdateSchema>;
