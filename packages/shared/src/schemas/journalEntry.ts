import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneyString = z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal up to 4dp');

export const journalLineInputSchema = z.object({
  account_id: z.string().uuid(),
  debit: moneyString,
  credit: moneyString,
  memo: z.string().max(500).nullable().optional(),
}).refine(l => !(parseFloat(l.debit) > 0 && parseFloat(l.credit) > 0), 'a line cannot have both debit and credit')
  .refine(l => parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0, 'a line must have either debit or credit > 0');

export type JournalLineInput = z.infer<typeof journalLineInputSchema>;

export const journalEntryCreateSchema = z.object({
  entry_date: dateString,
  memo: z.string().max(1000).nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  lines: z.array(journalLineInputSchema).min(2, 'at least two lines required'),
});
export type JournalEntryCreate = z.infer<typeof journalEntryCreateSchema>;

export const journalEntryVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
