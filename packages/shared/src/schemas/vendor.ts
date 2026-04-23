import { z } from 'zod';

export const vendorCreateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  billing_address: z.record(z.string().max(200)).nullable().optional(),
  tax_id: z.string().max(50).nullable().optional(),
  is_1099: z.boolean().optional(),
  default_terms_days: z.number().int().min(0).max(365).optional(),
});
export type VendorCreate = z.infer<typeof vendorCreateSchema>;

export const vendorUpdateSchema = vendorCreateSchema.partial();
export type VendorUpdate = z.infer<typeof vendorUpdateSchema>;
