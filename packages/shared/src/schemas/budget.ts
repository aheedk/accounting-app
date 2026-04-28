import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const budgetCreateSchema = z.object({
  name: z.string().min(1).max(200),
  fiscal_year: z.number().int().min(2000).max(2100),
});
export type BudgetCreate = z.infer<typeof budgetCreateSchema>;

export const budgetUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

export const setBudgetLineSchema = z.object({
  account_id: z.string().uuid(),
  month_offset: z.number().int().min(0).max(11),
  amount: moneyStr,
});
