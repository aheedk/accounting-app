import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reconciliationStartSchema = z.object({
  account_id: z.string().uuid(),
  statement_ending_balance: moneyStr,
  statement_ending_date: dateStr,
  service_charge_amount: moneyStr.nullable().optional(),
  service_charge_date: dateStr.nullable().optional(),
  service_charge_account_id: z.string().uuid().nullable().optional(),
  interest_earned_amount: moneyStr.nullable().optional(),
  interest_earned_date: dateStr.nullable().optional(),
  interest_earned_account_id: z.string().uuid().nullable().optional(),
});
export type ReconciliationStart = z.infer<typeof reconciliationStartSchema>;

export const reconciliationSaveItemsSchema = z.object({
  items: z.array(z.object({
    transaction_type: z.enum(['deposit', 'expense', 'check', 'journal_entry', 'service_charge', 'interest']),
    transaction_id: z.string().uuid(),
    is_cleared: z.boolean(),
  })),
});
export type ReconciliationSaveItems = z.infer<typeof reconciliationSaveItemsSchema>;

