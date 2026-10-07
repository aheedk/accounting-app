import { z } from 'zod';

// A learned coding rule keeps its vendor and direction. What can change is
// where it posts: one account for each of its lines, in order.
export const codingRuleUpdateSchema = z.object({
  account_ids: z.array(z.string().uuid()).min(1).max(20),
});
export type CodingRuleUpdate = z.infer<typeof codingRuleUpdateSchema>;