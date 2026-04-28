import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const billPaymentDraftCreateSchema = z.object({
  vendor_id: z.string().uuid(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: z.enum(['cash','check','ach','wire','card','other']),
  reference: z.string().max(200).nullable().optional(),
  amount: moneyStr,
  cash_account_id: z.string().uuid(),
  memo: z.string().nullable().optional(),
  initial_applications: z.array(z.object({
    bill_id: z.string().uuid(),
    applied_amount: moneyStr,
  })).optional(),
});

export const billPaymentApplicationSchema = z.object({
  bill_id: z.string().uuid(),
  applied_amount: moneyStr,
});

export const billPaymentVoidSchema = z.object({ void_reason: z.string().min(1).max(500) });
