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
