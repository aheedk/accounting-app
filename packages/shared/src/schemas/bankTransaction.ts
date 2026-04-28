import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const bankTransactionImportSchema = z.object({
  bank_account_id: z.string().uuid(),
  rows: z.array(z.object({
    transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().min(1).max(500),
    amount: moneyStr,
    external_id: z.string().max(200).nullable().optional(),
  })).min(1).max(5000),
});
export type BankTransactionImport = z.infer<typeof bankTransactionImportSchema>;

export const bankTransactionMatchSchema = z.object({
  journal_entry_id: z.string().uuid(),
});
export type BankTransactionMatch = z.infer<typeof bankTransactionMatchSchema>;

export const bankTransactionCategorizeSchema = z.object({
  offset_account_id: z.string().uuid(),
  memo: z.string().max(500).nullable().optional(),
});
export type BankTransactionCategorize = z.infer<typeof bankTransactionCategorizeSchema>;

export const bankTransactionExcludeSchema = z.object({
  excluded_reason: z.string().min(1).max(500),
});
export type BankTransactionExclude = z.infer<typeof bankTransactionExcludeSchema>;
