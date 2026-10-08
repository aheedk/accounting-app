import { z } from 'zod';

// The approval step: staff entries that wait for an accountant.
export const approvalListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const approvalRejectSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});
