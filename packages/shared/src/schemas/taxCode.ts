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

// The code itself is fixed once created. A rate is never rewritten: a new one
// takes over from a date, and earlier dates keep the rate they had.
export const taxCodeUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  tax_payable_account_id: z.string().uuid().optional(),
  is_active: z.boolean().optional(),
  new_rate: z.object({ rate: z.number().min(0).max(1), effective_from: dateString }).optional(),
});
export type TaxCodeUpdate = z.infer<typeof taxCodeUpdateSchema>;
