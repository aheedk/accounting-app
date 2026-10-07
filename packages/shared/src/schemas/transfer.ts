import { z } from 'zod';

// Move money between two of a client's own accounts (checking to savings, a
// payment toward a card or a loan).
export const transferCreateSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount: z.union([z.string(), z.number()]).transform(v => String(v))
    .refine(v => Number.isFinite(Number(v)) && Number(v) > 0, { message: 'Enter an amount above zero' }),
  transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().max(500).nullable().optional(),
});
export type TransferCreate = z.infer<typeof transferCreateSchema>;
