import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const paymentMethodEnum = z.enum(['cash', 'check', 'ach', 'wire', 'card', 'other']);

export const paymentDraftCreateSchema = z.object({
  customer_id: z.string().uuid(),
  payment_date: dateString,
  payment_method: paymentMethodEnum,
  reference: z.string().max(200).nullable().optional(),
  amount: money,
  cash_account_id: z.string().uuid(),
  memo: z.string().max(500).nullable().optional(),
  initial_applications: z.array(z.object({
    invoice_id: z.string().uuid(),
    applied_amount: money,
  })).optional(),
});
export type PaymentDraftCreate = z.infer<typeof paymentDraftCreateSchema>;

export const paymentApplicationSchema = z.object({
  invoice_id: z.string().uuid(),
  applied_amount: money,
});

export const paymentVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
