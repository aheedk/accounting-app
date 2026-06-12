import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const bankRuleCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description_contains: z.string().min(1).max(500),
  min_amount: moneyStr.nullable().optional(),
  max_amount: moneyStr.nullable().optional(),
  sign_filter: z.enum(['any', 'inflow_only', 'outflow_only']).optional(),
  offset_account_id: z.string().uuid(),
  bank_account_id: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
});
export type BankRuleCreate = z.infer<typeof bankRuleCreateSchema>;

export const bankRuleUpdateSchema = bankRuleCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
});
export type BankRuleUpdate = z.infer<typeof bankRuleUpdateSchema>;

export const bankRuleApplySchema = z.object({
  bank_account_id: z.string().uuid(),
});
export type BankRuleApply = z.infer<typeof bankRuleApplySchema>;
