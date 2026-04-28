import { z } from 'zod';

export const complianceItemUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'na']).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  document_file_id: z.string().uuid().nullable().optional(),
});
export type ComplianceItemUpdate = z.infer<typeof complianceItemUpdateSchema>;
