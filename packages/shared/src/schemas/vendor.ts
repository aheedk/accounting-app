import { z } from 'zod';

export const vendorCreateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  billing_address: z.record(z.string().max(200)).nullable().optional(),
  tax_id: z.string().min(1).max(50).nullable().optional(),
  tax_id_type: z.enum(['SSN', 'EIN']).nullable().optional(),
  is_1099: z.boolean().optional(),
  default_terms_days: z.number().int().min(0).max(365).optional(),
}).refine(
  v => (v.tax_id == null) === (v.tax_id_type == null),
  { message: 'tax_id and tax_id_type must be set together' },
);
export type VendorCreate = z.infer<typeof vendorCreateSchema>;

export const vendorUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  billing_address: z.record(z.string().max(200)).nullable().optional(),
  tax_id: z.string().min(1).max(50).nullable().optional(),
  tax_id_type: z.enum(['SSN', 'EIN']).nullable().optional(),
  is_1099: z.boolean().optional(),
  default_terms_days: z.number().int().min(0).max(365).optional(),
}).refine(
  v => v.tax_id === undefined || v.tax_id_type !== undefined || v.tax_id === null,
  { message: 'tax_id and tax_id_type must be patched together' },
);
export type VendorUpdate = z.infer<typeof vendorUpdateSchema>;
