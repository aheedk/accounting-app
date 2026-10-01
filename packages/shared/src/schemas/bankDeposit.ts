import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const bankDepositLineSchema = z.object({
  received_from: z.string().max(200).nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  payment_method: z.string().max(100).nullable().optional(),
  ref_no: z.string().max(100).nullable().optional(),
  amount: moneyStr,
  sort_order: z.number().int().optional(),
});

export const bankDepositCreateSchema = z.object({
  bank_account_id: z.string().uuid(),
  deposit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().max(2000).nullable().optional(),
  lines: z.array(bankDepositLineSchema).min(1),
  cash_back_account_id: z.string().uuid().nullable().optional(),
  cash_back_memo: z.string().max(500).nullable().optional(),
  cash_back_amount: moneyStr.nullable().optional(),
});
export type BankDepositCreate = z.infer<typeof bankDepositCreateSchema>;

export const bankDepositUpdateSchema = bankDepositCreateSchema.partial().extend({
  bank_account_id: z.string().uuid().optional(),
  deposit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type BankDepositUpdate = z.infer<typeof bankDepositUpdateSchema>;
