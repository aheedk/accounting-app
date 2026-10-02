import { z } from 'zod';

const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A dedicated, app-level list rather than the full shared payment_method
// enum: the Expense form offers exactly these six, splitting credit/debit
// card (which the enum itself now supports) and leaving out legacy-only
// values like 'wire' that this form never surfaces.
export const expensePaymentMethodSchema = z.enum([
  'cash', 'check', 'credit_card', 'debit_card', 'ach', 'other',
]);
export type ExpensePaymentMethod = z.infer<typeof expensePaymentMethodSchema>;

export const expenseLineSchema = z.object({
  category_account_id: z.string().uuid(),
  description: z.string().max(500).nullable().optional(),
  amount: moneyStr,
  sort_order: z.number().int().min(0).optional(),
});
export type ExpenseLine = z.infer<typeof expenseLineSchema>;

export const expenseTransactionCreateSchema = z.object({
  transaction_date: dateStr,
  payee_text: z.string().min(1).max(200).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  payment_account_id: z.string().uuid(),
  payment_method: expensePaymentMethodSchema,
  reference: z.string().trim().max(100).nullable().optional(),
  memo: z.string().max(2000).nullable().optional(),
  lines: z.array(expenseLineSchema).min(1),
}).refine(
  v => Boolean(v.payee_text) || Boolean(v.vendor_id) || Boolean(v.customer_id),
  { message: 'payee_text, vendor_id, or customer_id is required' },
).refine(
  v => !(v.vendor_id && v.customer_id),
  { message: 'pick one payee — a vendor or a customer, not both' },
);
export type ExpenseTransactionCreate = z.infer<typeof expenseTransactionCreateSchema>;

// Update resends the whole form, same as bankDepositUpdateSchema — no partial
// patches, since the editor always round-trips the full set of lines.
export const expenseTransactionUpdateSchema = z.object({
  transaction_date: dateStr,
  payee_text: z.string().min(1).max(200).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  payment_account_id: z.string().uuid(),
  payment_method: expensePaymentMethodSchema,
  reference: z.string().trim().max(100).nullable().optional(),
  memo: z.string().max(2000).nullable().optional(),
  lines: z.array(expenseLineSchema).min(1),
}).refine(
  v => Boolean(v.payee_text) || Boolean(v.vendor_id) || Boolean(v.customer_id),
  { message: 'payee_text, vendor_id, or customer_id is required' },
).refine(
  v => !(v.vendor_id && v.customer_id),
  { message: 'pick one payee — a vendor or a customer, not both' },
);
export type ExpenseTransactionUpdate = z.infer<typeof expenseTransactionUpdateSchema>;
