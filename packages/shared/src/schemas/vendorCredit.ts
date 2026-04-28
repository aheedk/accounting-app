import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const vendorCreditCreateSchema = z.object({
  vendor_id: z.string().uuid(),
  credit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: moneyStr,
  offset_account_id: z.string().uuid(),
  memo: z.string().nullable().optional(),
});

export const vendorCreditApplySchema = z.object({
  bill_id: z.string().uuid(),
  applied_amount: moneyStr,
});

export const vendorCreditVoidSchema = z.object({ void_reason: z.string().min(1).max(500) });
