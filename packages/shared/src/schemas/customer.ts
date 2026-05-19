import { z } from 'zod';

export const customerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  company_name: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  billing_address: z.object({
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(50).optional(),
    postal_code: z.string().max(20).optional(),
    country: z.string().max(80).optional(),
  }).nullable().optional(),
  default_terms_days: z.number().int().min(0).max(365).optional(),
});
export type CustomerCreate = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema.partial();
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;
