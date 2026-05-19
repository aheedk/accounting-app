import { z } from 'zod';

const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.string().max(80).optional(),
}).nullable().optional();

const moneyString = z.union([z.string(), z.number()]).transform(v => String(v)).pipe(z.string().regex(/^-?\d+(\.\d+)?$/));

export const customerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  company_name: z.string().max(200).nullable().optional(),
  title: z.string().max(20).nullable().optional(),
  first_name: z.string().max(100).nullable().optional(),
  middle_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  suffix: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional(),
  email_cc: z.string().max(200).nullable().optional(),
  email_bcc: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  mobile: z.string().max(50).nullable().optional(),
  fax: z.string().max(50).nullable().optional(),
  other_phone: z.string().max(50).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  name_on_checks: z.string().max(200).nullable().optional(),
  billing_address: addressSchema,
  shipping_address: addressSchema,
  shipping_same_as_billing: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
  primary_payment_method: z.string().max(50).nullable().optional(),
  sales_form_delivery: z.string().max(50).nullable().optional(),
  invoice_language: z.string().max(50).optional(),
  credit_limit: moneyString.nullable().optional(),
  customer_type: z.string().max(100).nullable().optional(),
  tax_exemption_details: z.string().max(500).nullable().optional(),
  opening_balance: moneyString.nullable().optional(),
  opening_balance_as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  default_terms_days: z.number().int().min(0).max(365).optional(),
});
export type CustomerCreate = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema.partial();
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;
