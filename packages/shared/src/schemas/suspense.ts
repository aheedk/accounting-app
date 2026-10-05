import { z } from 'zod';

// Move one Suspense item to the account it belongs in.
export const suspenseReclassifySchema = z.object({
  account_id: z.string().uuid(),
  // Teach the coding engine this vendor's account, as "remember" does in the AI inbox.
  remember: z.boolean().optional(),
});
export type SuspenseReclassify = z.infer<typeof suspenseReclassifySchema>;
