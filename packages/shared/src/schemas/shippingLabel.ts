import { z } from 'zod';
const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);

export const shippingLabelCreateSchema = z.object({
  invoice_id: z.string().uuid().nullable().optional(),
  sales_order_id: z.string().uuid().nullable().optional(),
  carrier: z.string().min(1).max(100),
  tracking_number: z.string().min(1).max(200),
  shipped_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost: moneyStr.nullable().optional(),
  label_file_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine(
  v => Boolean(v.invoice_id) || Boolean(v.sales_order_id),
  { message: 'either invoice_id or sales_order_id is required' },
);
export type ShippingLabelCreate = z.infer<typeof shippingLabelCreateSchema>;

export const shippingLabelUpdateSchema = z.object({
  carrier: z.string().min(1).max(100).optional(),
  tracking_number: z.string().min(1).max(200).optional(),
  shipped_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cost: moneyStr.nullable().optional(),
  label_file_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
