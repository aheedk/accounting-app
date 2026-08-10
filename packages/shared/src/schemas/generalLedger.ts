import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const generalLedgerQuerySchema = z.object({
  period_start: dateString,
  period_end: dateString,
  account_id: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if (value.period_start > value.period_end) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['period_end'],
      message: 'Period end must be on or after period start',
    });
  }
});

export type GeneralLedgerQuery = z.infer<typeof generalLedgerQuerySchema>;
