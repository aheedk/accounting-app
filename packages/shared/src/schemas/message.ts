import { z } from 'zod';

// The thread between a client and the firm.
export const messageCreateSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(5000),
});
export type MessageCreate = z.infer<typeof messageCreateSchema>;

export const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});
