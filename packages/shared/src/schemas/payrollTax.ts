import { z } from 'zod';
const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);

export const payrollTaxRecordSchema = z.object({
  period: z.enum(['monthly', 'quarterly', 'annual']),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  liability_account_id: z.string().uuid(),
  amount: moneyStr,
  notes: z.string().max(2000).nullable().optional(),
});
export type PayrollTaxRecord = z.infer<typeof payrollTaxRecordSchema>;

export const payrollTaxPaySchema = z.object({
  cash_account_id: z.string().uuid(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
