import { z } from 'zod';

export const periodReviewTaskUpdateSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type PeriodReviewTaskUpdate = z.infer<typeof periodReviewTaskUpdateSchema>;
