import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneyString = z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal up to 4dp');
const optionalLineText = z.string().max(255).nullable().optional();

export const journalLineInputSchema = z.object({
  account_id: z.string().uuid(),
  debit: moneyString,
  credit: moneyString,
  memo: z.string().max(500).nullable().optional(),
  name: optionalLineText,
  class_name: optionalLineText,
}).refine(l => !(parseFloat(l.debit) > 0 && parseFloat(l.credit) > 0), 'a line cannot have both debit and credit')
  .refine(l => parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0, 'a line must have either debit or credit > 0');

export type JournalLineInput = z.infer<typeof journalLineInputSchema>;

export const journalEntryCreateSchema = z.object({
  entry_date: dateString,
  journal_number: z.string().trim().min(1).max(99)
    .refine(value => !value.endsWith('R'), 'the R suffix is reserved for reversal entries')
    .nullable().optional(),
  memo: z.string().max(1000).nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  is_adjusting: z.boolean().optional().default(false),
  lines: z.array(journalLineInputSchema).min(2, 'at least two lines required'),
});
export type JournalEntryCreate = z.infer<typeof journalEntryCreateSchema>;

export const journalEntryCorrectionSchema = journalEntryCreateSchema;
export type JournalEntryCorrection = z.infer<typeof journalEntryCorrectionSchema>;

// A reversal as the user left it on the entry screen. Every part is optional:
// with none of them the reversal is the original with debits and credits
// swapped, dated the first day of the next month. The number is not here: it is
// always the original's number followed by R.
export const journalEntryReverseSchema = z.object({
  entry_date: dateString.optional(),
  memo: z.string().max(1000).nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  lines: z.array(journalLineInputSchema).min(2, 'at least two lines required').optional(),
});
export type JournalEntryReverse = z.infer<typeof journalEntryReverseSchema>;

export const journalEntryVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
