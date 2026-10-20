import { z } from 'zod';
import { phoneSchema } from '../phone.js';
import { expensePaymentMethodSchema } from './expenseTransaction.js';

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
  phone: phoneSchema,
  import_email: z.string().email().max(254).nullable().optional(),
  /** Opt in to posting high-confidence AI suggestions without review. */
  ai_auto_post_enabled: z.boolean().optional(),
  // With this on, what a staff login enters that would post at once waits for an accountant.
  staff_entries_need_approval: z.boolean().optional(),
  /** Invoice lines at or above this amount are capitalized instead of expensed. */
  capitalization_threshold: z.coerce.number().min(0).max(10_000_000).optional(),
  // Company settings (Setup -> Company Settings).
  invoice_number_prefix: z.string().regex(/^[A-Za-z0-9-]{0,10}$/, 'Letters, digits and dashes only, up to 10').optional(),
  /** Where invoice numbers start; null goes back to 1001. */
  invoice_next_number: z.number().int().min(1).max(999_999_999).nullable().optional(),
  default_invoice_terms_days: z.number().int().min(0).max(365).optional(),
  default_bill_terms_days: z.number().int().min(0).max(365).optional(),
  default_sales_tax_code_id: z.string().uuid().nullable().optional(),
  default_expense_payment_method: expensePaymentMethodSchema.optional(),
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
