import { z } from 'zod';

const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const checkPayeeTypeSchema = z.enum(['vendor', 'customer', 'other']);
export type CheckPayeeType = z.infer<typeof checkPayeeTypeSchema>;

export const checkLineSchema = z.object({
  account_id: z.string().uuid(),
  description: z.string().max(500).nullable().optional(),
  amount: moneyStr,
});
export type CheckLine = z.infer<typeof checkLineSchema>;

const checkShared = {
  payment_date: dateStr,
  payee_id: z.string().uuid().nullable().optional(),
  payee_type: checkPayeeTypeSchema.nullable().optional(),
  payee_text: z.string().min(1).max(200).nullable().optional(),
  bank_account_id: z.string().uuid(),
  // Omitted (or blank) on create means "auto-assign the next number for this
  // bank account" — see checkService.nextCheckNumber.
  check_number: z.string().trim().max(50).nullable().optional(),
  mailing_address: z.string().max(1000).nullable().optional(),
  memo: z.string().max(2000).nullable().optional(),
  print_later: z.boolean().optional(),
  lines: z.array(checkLineSchema).min(1),
};

export const checkCreateSchema = z.object(checkShared).refine(
  v => Boolean(v.payee_text) || Boolean(v.payee_id),
  { message: 'payee_id or payee_text is required' },
);
export type CheckCreate = z.infer<typeof checkCreateSchema>;

// Update resends the whole form, same as expenseTransactionUpdateSchema — no
// partial patches, since the editor always round-trips the full set of lines.
export const checkUpdateSchema = z.object(checkShared).refine(
  v => Boolean(v.payee_text) || Boolean(v.payee_id),
  { message: 'payee_id or payee_text is required' },
);
export type CheckUpdate = z.infer<typeof checkUpdateSchema>;

export const checkVoidSchema = z.object({
  void_reason: z.string().max(500).nullable().optional(),
});
