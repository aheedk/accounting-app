import { z } from 'zod';

export const trialBalanceQuerySchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const trialBalanceRowSchema = z.object({
  account_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  total_debit: z.string(),
  total_credit: z.string(),
  net: z.string(),
});

export const trialBalanceResponseSchema = z.object({
  as_of: z.string(),
  rows: z.array(trialBalanceRowSchema),
  totals: z.object({
    total_debit: z.string(),
    total_credit: z.string(),
  }),
});
