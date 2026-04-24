import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const fixedAssetCreateSchema = z.object({
  name: z.string().min(1).max(200),
  asset_account_id: z.string().uuid(),
  depreciation_expense_account_id: z.string().uuid(),
  accumulated_depreciation_account_id: z.string().uuid(),
  purchase_date: dateStr,
  cost: moneyStr,
  salvage_value: moneyStr.optional(),
  useful_life_years: z.number().int().min(1).max(100),
  memo: z.string().max(500).nullable().optional(),
});
export type FixedAssetCreate = z.infer<typeof fixedAssetCreateSchema>;

export const fixedAssetUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  memo: z.string().max(500).nullable().optional(),
});
export type FixedAssetUpdate = z.infer<typeof fixedAssetUpdateSchema>;

export const depreciationRunSchema = z.object({
  period_end: dateStr,
});
export type DepreciationRun = z.infer<typeof depreciationRunSchema>;
