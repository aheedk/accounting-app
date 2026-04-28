import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const billLineCreateSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: moneyStr,
  unit_price: moneyStr,
  expense_account_id: z.string().uuid(),
});

export const billDraftCreateSchema = z.object({
  vendor_id: z.string().uuid(),
  bill_number: z.string().min(1).max(100),
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  lines: z.array(billLineCreateSchema).min(1),
});
export type BillDraftCreate = z.infer<typeof billDraftCreateSchema>;

export const billVoidSchema = z.object({ void_reason: z.string().min(1).max(500) });
