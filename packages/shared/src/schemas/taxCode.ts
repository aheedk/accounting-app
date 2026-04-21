import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const taxCodeCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  tax_payable_account_id: z.string().uuid(),
  initial_rate: z.object({
    rate: z.number().min(0).max(1),
    effective_from: dateString,
    effective_to: dateString.nullable().optional(),
  }),
});
export type TaxCodeCreate = z.infer<typeof taxCodeCreateSchema>;

export const taxRateAddSchema = z.object({
  rate: z.number().min(0).max(1),
  effective_from: dateString,
  effective_to: dateString.nullable().optional(),
});
