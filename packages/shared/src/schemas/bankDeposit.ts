import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const bankDepositLineSchema = z.object({
  line_type: z.enum(['other_funds', 'undeposited_funds']).optional(),
  payment_id: z.string().uuid().nullable().optional(),
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

// Update resends the full form (bank account, date, memo, cash-back), but
// `lines` only carries the editable "other funds" rows — the service keeps
// undeposited-funds lines as posted, so an all-undeposited deposit legally
// resends an empty array here (unlike create, which requires at least one line).
export const bankDepositUpdateSchema = z.object({
  bank_account_id: z.string().uuid(),
  deposit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().max(2000).nullable().optional(),
  lines: z.array(bankDepositLineSchema),
  cash_back_account_id: z.string().uuid().nullable().optional(),
  cash_back_memo: z.string().max(500).nullable().optional(),
  cash_back_amount: moneyStr.nullable().optional(),
});
export type BankDepositUpdate = z.infer<typeof bankDepositUpdateSchema>;
