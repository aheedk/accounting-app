import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const creditMemoCreateSchema = z.object({
  customer_id: z.string().uuid(),
  memo_date: dateString,
  amount: money,
  revenue_account_id: z.string().uuid(),
  memo: z.string().max(1000).nullable().optional(),
});
export type CreditMemoCreate = z.infer<typeof creditMemoCreateSchema>;

export const creditMemoApplySchema = z.object({
  invoice_id: z.string().uuid(),
  applied_amount: money,
});

export const creditMemoVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
