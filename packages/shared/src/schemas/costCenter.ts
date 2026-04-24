import { z } from 'zod';

export const costCenterCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50).nullable().optional(),
  is_active: z.boolean().optional(),
});
export type CostCenterCreate = z.infer<typeof costCenterCreateSchema>;

export const costCenterUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).nullable().optional(),
  is_active: z.boolean().optional(),
});
export type CostCenterUpdate = z.infer<typeof costCenterUpdateSchema>;
