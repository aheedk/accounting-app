import { z } from 'zod';
const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);

export const salesOrderLineSchema = z.object({
  inventory_item_id: z.string().uuid(),
  description: z.string().max(500).nullable().optional(),
  quantity: moneyStr,
  unit_price: moneyStr,
});

export const salesOrderCreateSchema = z.object({
  customer_id: z.string().uuid(),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().max(2000).nullable().optional(),
  lines: z.array(salesOrderLineSchema).min(1).max(500),
});
export type SalesOrderCreate = z.infer<typeof salesOrderCreateSchema>;

export const salesOrderUpdateSchema = z.object({
  memo: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'confirmed', 'fulfilled', 'void']).optional(),
});
