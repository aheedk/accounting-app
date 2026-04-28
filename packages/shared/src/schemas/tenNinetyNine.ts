import { z } from 'zod';

export const tenNinetyNineQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(9999),
});
export type TenNinetyNineQuery = z.infer<typeof tenNinetyNineQuerySchema>;
