import { z } from 'zod';

const moneyString = z.union([z.string(), z.number()]).transform(v => String(v)).pipe(z.string().regex(/^-?\d+(\.\d+)?$/));

// QBO-style expanded vendor fields (mirrors customers; ACH bank info intentionally omitted).
const vendorExpandedFields = {
  company_name: z.string().max(200).nullable().optional(),
  title: z.string().max(20).nullable().optional(),
  first_name: z.string().max(100).nullable().optional(),
  middle_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  suffix: z.string().max(20).nullable().optional(),
  email_cc: z.string().max(200).nullable().optional(),
  email_bcc: z.string().max(200).nullable().optional(),
  mobile: z.string().max(50).nullable().optional(),
  fax: z.string().max(50).nullable().optional(),
  other_phone: z.string().max(50).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  name_on_checks: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  account_number: z.string().max(100).nullable().optional(),
  default_expense_account_id: z.string().uuid().nullable().optional(),
  opening_balance: moneyString.nullable().optional(),
  opening_balance_as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
};

export const vendorCreateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  billing_address: z.record(z.string().max(200)).nullable().optional(),
  tax_id: z.string().min(1).max(50).nullable().optional(),
  tax_id_type: z.enum(['SSN', 'EIN']).nullable().optional(),
  is_1099: z.boolean().optional(),
  default_terms_days: z.number().int().min(0).max(365).optional(),
  ...vendorExpandedFields,
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
  ...vendorExpandedFields,
}).refine(
  v => v.tax_id === undefined || v.tax_id_type !== undefined || v.tax_id === null,
  { message: 'tax_id and tax_id_type must be patched together' },
);
export type VendorUpdate = z.infer<typeof vendorUpdateSchema>;
