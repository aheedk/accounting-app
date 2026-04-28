import { z } from 'zod';

export const itemReceiptCreateSchema = z.object({
  purchase_order_id: z.string().uuid(),
  receipt_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().max(2000).nullable().optional(),
});
export type ItemReceiptCreate = z.infer<typeof itemReceiptCreateSchema>;
