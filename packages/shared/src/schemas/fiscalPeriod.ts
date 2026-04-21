import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const periodCreateSchema = z.object({
  starts_on: dateString,
  ends_on: dateString,
});
export type PeriodCreate = z.infer<typeof periodCreateSchema>;

export const seedYearSchema = z.object({
  year: z.number().int().min(1900).max(2100),
});

export const periodCloseSchema = z.object({
  period_id: z.string().uuid(),
});

export const adminOverrideRequestSchema = z.object({
  reason: z.string().min(10).max(500),
});
