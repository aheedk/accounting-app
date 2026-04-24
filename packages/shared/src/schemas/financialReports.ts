import { z } from 'zod';

export const pnlQuerySchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type PnlQuery = z.infer<typeof pnlQuerySchema>;

export const balanceSheetQuerySchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type BalanceSheetQuery = z.infer<typeof balanceSheetQuerySchema>;

export const cashFlowQuerySchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cash_account_id: z.string().uuid().optional(),
});
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;

export const periodCloseBodySchema = z.object({
  memo: z.string().max(500).nullable().optional(),
});

export const periodReopenBodySchema = z.object({
  reason: z.string().min(1).max(500),
});
