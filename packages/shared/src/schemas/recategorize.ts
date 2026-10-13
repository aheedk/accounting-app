import { z } from 'zod';

/** Shared by the Transaction List tab's inline Category edit, across whichever
 * single-line transaction type it's changing an account on. */
export const recategorizeSchema = z.object({
  account_id: z.string().uuid(),
});
export type Recategorize = z.infer<typeof recategorizeSchema>;
