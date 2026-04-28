import { z } from 'zod';
const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);

export const purchaseOrderLineSchema = z.object({
  inventory_item_id: z.string().uuid(),
  description: z.string().max(500).nullable().optional(),
  quantity: moneyStr,
  unit_cost: moneyStr,
});

export const purchaseOrderCreateSchema = z.object({
  vendor_id: z.string().uuid(),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  memo: z.string().max(2000).nullable().optional(),
  lines: z.array(purchaseOrderLineSchema).min(1).max(500),
});
export type PurchaseOrderCreate = z.infer<typeof purchaseOrderCreateSchema>;

export const purchaseOrderUpdateSchema = z.object({
  expected_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  memo: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'sent', 'received', 'closed', 'void']).optional(),
});
