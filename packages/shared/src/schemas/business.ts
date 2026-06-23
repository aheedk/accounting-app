import { z } from 'zod';

export const businessAddressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.string().max(80).optional(),
});
export type BusinessAddressInput = z.infer<typeof businessAddressSchema>;

export const businessUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  legal_name: z.string().min(1).max(200).nullable().optional(),
  tax_id: z.string().min(1).max(50).nullable().optional(),
  fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
  address: businessAddressSchema.nullable().optional(),
});
export type BusinessUpdate = z.infer<typeof businessUpdateSchema>;

export const businessCreateSchema = z.object({
  name: z.string().min(1).max(200),
  legal_name: z.string().min(1).max(200).nullable().optional(),
  tax_id: z.string().min(1).max(50).nullable().optional(),
  fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
  address: businessAddressSchema.nullable().optional(),
});
export type BusinessCreate = z.infer<typeof businessCreateSchema>;
