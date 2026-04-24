import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const reconciliationCreateSchema = z.object({
  bank_account_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statement_ending_balance: moneyStr,
  memo: z.string().max(500).nullable().optional(),
});
export type ReconciliationCreate = z.infer<typeof reconciliationCreateSchema>;
