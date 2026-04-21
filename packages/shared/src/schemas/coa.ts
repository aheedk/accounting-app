import { z } from 'zod';

export const accountTypeEnum = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);

export const accountCreateSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(1).max(120),
  account_type: accountTypeEnum,
  parent_id: z.string().uuid().nullable().optional(),
});
export type AccountCreate = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;
