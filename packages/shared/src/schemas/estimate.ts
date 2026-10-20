import { z } from 'zod';

// Spec: docs/specs/2026-10-20-estimates-design.md
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be non-negative decimal, up to 4dp');

export const estimateLineInputSchema = z.object({
  inventory_item_id: z.string().uuid().nullable().optional(),
  description: z.string().min(1).max(500),
  quantity: money.refine(q => Number(q) > 0, 'quantity must be more than 0'),
  unit_price: money,
  revenue_account_id: z.string().uuid(),
  tax_code_id: z.string().uuid().nullable().optional(),
});
export type EstimateLineInput = z.infer<typeof estimateLineInputSchema>;

/** A new estimate, and an edit (the whole estimate again). */
export const estimateSaveSchema = z.object({
  customer_id: z.string().uuid(),
  estimate_date: dateString,
  expiration_date: dateString.nullable().optional(),
  memo: z.string().max(1000).nullable().optional(),
  lines: z.array(estimateLineInputSchema).min(1).max(500),
}).refine(e => !e.expiration_date || e.expiration_date >= e.estimate_date, {
  message: 'The expiration date cannot be before the estimate date',
  path: ['expiration_date'],
});
export type EstimateSave = z.infer<typeof estimateSaveSchema>;

/** Closed is reached only by making the invoice. */
export const estimateStatusSchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']),
  accepted_by: z.string().max(200).nullable().optional(),
  accepted_date: dateString.nullable().optional(),
});
export type EstimateStatusChange = z.infer<typeof estimateStatusSchema>;

export const estimateConvertSchema = z.object({
  issue_date: dateString.optional(),
});
