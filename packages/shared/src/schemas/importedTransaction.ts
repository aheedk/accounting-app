import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positiveMoney = z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be a positive decimal up to 4dp')
  .refine(value => parseFloat(value) > 0, 'amount must be greater than zero');

// Edit form for a Check / Expense / Deposit posted from a bank statement import.
export const importedTransactionUpdateSchema = z.object({
  entry_date: dateString,
  transaction_type: z.enum(['check', 'expense', 'deposit', 'credit_card_payment', 'credit_card_credit']),
  payee_name: z.string().trim().max(200).nullable().optional(),
  check_number: z.string().trim().max(30).nullable().optional(),
  memo: z.string().max(1000).nullable().optional(),
  bank_account_id: z.string().uuid(),
  category_account_id: z.string().uuid(),
  amount: positiveMoney,
});
export type ImportedTransactionUpdate = z.infer<typeof importedTransactionUpdateSchema>;
