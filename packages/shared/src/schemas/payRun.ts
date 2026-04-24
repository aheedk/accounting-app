import { z } from 'zod';
const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);

export const payRunLineInputSchema = z.object({
  employee_id: z.string().uuid(),
  gross: moneyStr,
  federal_wh: moneyStr.optional(),
  state_wh: moneyStr.optional(),
  fica_employee: moneyStr.optional(),
  fica_employer: moneyStr.optional(),
  medicare_employee: moneyStr.optional(),
  medicare_employer: moneyStr.optional(),
  other_deductions: moneyStr.optional(),
});

export const payRunCreateSchema = z.object({
  pay_period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pay_period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().max(2000).nullable().optional(),
  accounts: z.object({
    wages_expense: z.string().uuid(),
    payroll_tax_expense: z.string().uuid(),
    cash: z.string().uuid(),
    fed_tax_liability: z.string().uuid(),
    state_tax_liability: z.string().uuid().nullable().optional(),
    fica_liability: z.string().uuid(),
  }),
  lines: z.array(payRunLineInputSchema).min(1).max(500),
});
export type PayRunCreate = z.infer<typeof payRunCreateSchema>;
