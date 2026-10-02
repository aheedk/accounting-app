import { z } from 'zod';
import { invoiceLineInputSchema } from './invoice.js';
import { billLineCreateSchema } from './bill.js';

// Type-specific payload shapes. Dates and document numbers are per-run
// (assigned at materialization), so payloads carry neither.
export const recurringJePayloadSchema = z.object({
  memo: z.string().max(1000).nullable().optional(),
  reference: z.string().max(200).nullable().optional(),
  is_adjusting: z.boolean().optional(),
  lines: z.array(z.object({
    account_id: z.string().uuid(),
    debit: z.union([z.string(), z.number()]).transform(v => String(v)),
    credit: z.union([z.string(), z.number()]).transform(v => String(v)),
    memo: z.string().max(500).nullable().optional(),
    name: z.string().max(255).nullable().optional(),
    class_name: z.string().max(255).nullable().optional(),
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

// Deposit templates never carry undeposited-funds lines (payments in Undeposited
// Funds at materialization time are whatever happens to be there that day) — only
// the "other funds" lines, which are a fixed, user-edited list on the template.
export const recurringDepositLineSchema = z.object({
  received_from: z.string().max(200).nullable().optional(),
  account_id: z.string().uuid(),
  description: z.string().max(500).nullable().optional(),
  payment_method: z.string().max(100).nullable().optional(),
  ref_no: z.string().max(100).nullable().optional(),
  amount: z.union([z.string(), z.number()]).transform(v => String(v)),
});
export const recurringDepositPayloadSchema = z.object({
  bank_account_id: z.string().uuid(),
  memo: z.string().max(2000).nullable().optional(),
  lines: z.array(recurringDepositLineSchema).min(1),
});
export type RecurringDepositPayload = z.infer<typeof recurringDepositPayloadSchema>;

export const recurringExpenseLineSchema = z.object({
  category_account_id: z.string().uuid(),
  description: z.string().max(500).nullable().optional(),
  amount: z.union([z.string(), z.number()]).transform(v => String(v)),
});
export const recurringExpensePayloadSchema = z.object({
  payee_text: z.string().max(200).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  payment_account_id: z.string().uuid(),
  payment_method: z.string().max(50),
  reference: z.string().max(100).nullable().optional(),
  memo: z.string().max(2000).nullable().optional(),
  lines: z.array(recurringExpenseLineSchema).min(1),
});
export type RecurringExpensePayload = z.infer<typeof recurringExpensePayloadSchema>;

export const recurringTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  template_type: z.enum(['journal_entry', 'invoice', 'bill', 'deposit', 'expense']),
  payload: z.record(z.unknown()),
  recurrence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  // Deposit/Expense-only: scheduled auto-creates on next_run_date; reminder/
  // unscheduled never auto-fire (no notification channel exists yet) and are
  // materialized only via the explicit "run now" action. Ignored by other template types.
  recurrence_type: z.enum(['scheduled', 'reminder', 'unscheduled']).optional(),
  days_in_advance: z.number().int().min(0).nullable().optional(),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type RecurringTemplateCreate = z.infer<typeof recurringTemplateCreateSchema>;

export const recurringTemplateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  payload: z.record(z.unknown()).optional(),
  recurrence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  recurrence_type: z.enum(['scheduled', 'reminder', 'unscheduled']).optional(),
  days_in_advance: z.number().int().min(0).nullable().optional(),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_active: z.boolean().optional(),
});
export type RecurringTemplateUpdate = z.infer<typeof recurringTemplateUpdateSchema>;
