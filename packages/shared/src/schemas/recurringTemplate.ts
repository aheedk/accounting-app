import { z } from 'zod';

export const recurringTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  template_type: z.enum(['journal_entry', 'invoice', 'bill']),
  payload: z.record(z.unknown()),
  recurrence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type RecurringTemplateCreate = z.infer<typeof recurringTemplateCreateSchema>;

export const recurringTemplateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  payload: z.record(z.unknown()).optional(),
  recurrence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_active: z.boolean().optional(),
});
export type RecurringTemplateUpdate = z.infer<typeof recurringTemplateUpdateSchema>;
