import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const accountTypeEnum = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);

export const accountCreateSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(1).max(120),
  account_type: accountTypeEnum,
  parent_id: z.string().uuid().nullable().optional(),
  detail_type: z.string().max(80).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  // QBO-style opening balance: posts a JE against Opening Balance Equity as of
  // the given date. Balance-sheet accounts only (service-enforced).
  opening_balance: moneyStr.nullable().optional(),
  opening_balance_as_of: dateStr.nullable().optional(),
});
export type AccountCreate = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = z.object({
  // Same constraints as create; renumbering accounts is allowed for non-system accounts (QBO parity).
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/).optional(),
  name: z.string().min(1).max(120).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  detail_type: z.string().max(80).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;
