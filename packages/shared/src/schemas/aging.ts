import { z } from 'zod';

export const agingQuerySchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const agingRowSchema = z.object({
  customer_id: z.string().uuid(),
  customer_name: z.string(),
  current: z.string(),
  over_30: z.string(),
  over_60: z.string(),
  over_90: z.string(),
  total: z.string(),
});

// A customer's statement for a period: billed, paid, credited, and the balance at each step.
export const customerStatementQuerySchema = z.object({
  customer_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
