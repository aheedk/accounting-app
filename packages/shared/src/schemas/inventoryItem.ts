import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const inventoryItemCreateSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  unit_of_measure: z.string().min(1).max(50).optional(),
  purchase_cost: moneyStr.nullable().optional(),
  sale_price: moneyStr.nullable().optional(),
  income_account_id: z.string().uuid().nullable().optional(),
  expense_account_id: z.string().uuid().nullable().optional(),
  inventory_asset_account_id: z.string().uuid().nullable().optional(),
});
export type InventoryItemCreate = z.infer<typeof inventoryItemCreateSchema>;

export const inventoryItemUpdateSchema = inventoryItemCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
});
export type InventoryItemUpdate = z.infer<typeof inventoryItemUpdateSchema>;

export const stockAdjustSchema = z.object({
  movement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity_delta: z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .refine(v => parseFloat(v) !== 0, 'must be non-zero'),
  reason: z.enum(['adjustment', 'opening_balance', 'manual_in', 'manual_out', 'write_off']),
  memo: z.string().max(500).nullable().optional(),
});
export type StockAdjust = z.infer<typeof stockAdjustSchema>;
