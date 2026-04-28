import { z } from 'zod';

export const bankAccountCreateSchema = z.object({
  name: z.string().min(1).max(200),
  institution: z.string().max(200).nullable().optional(),
  account_last_four: z.string().regex(/^\d{4}$/).nullable().optional(),
  cash_account_id: z.string().uuid(),
});
export type BankAccountCreate = z.infer<typeof bankAccountCreateSchema>;

export const bankAccountUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  institution: z.string().max(200).nullable().optional(),
  account_last_four: z.string().regex(/^\d{4}$/).nullable().optional(),
  is_active: z.boolean().optional(),
});
export type BankAccountUpdate = z.infer<typeof bankAccountUpdateSchema>;
