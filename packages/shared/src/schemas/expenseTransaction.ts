import { z } from 'zod';
import { paymentMethodSchema } from './payment.js';
const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);

export const expenseTransactionCreateSchema = z.object({
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee_text: z.string().min(1).max(200).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  expense_account_id: z.string().uuid(),
  payment_account_id: z.string().uuid(),
  payment_method: paymentMethodSchema,
  amount: moneyStr,
  memo: z.string().max(500).nullable().optional(),
}).refine(
  v => Boolean(v.payee_text) || Boolean(v.vendor_id),
  { message: 'either payee_text or vendor_id is required' },
);
export type ExpenseTransactionCreate = z.infer<typeof expenseTransactionCreateSchema>;

export const expenseTransactionUpdateSchema = z.object({
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payee_text: z.string().min(1).max(200).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  expense_account_id: z.string().uuid().optional(),
  payment_account_id: z.string().uuid().optional(),
  payment_method: paymentMethodSchema.optional(),
  amount: moneyStr.optional(),
  memo: z.string().max(500).nullable().optional(),
});
export type ExpenseTransactionUpdate = z.infer<typeof expenseTransactionUpdateSchema>;
