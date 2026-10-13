import { z } from 'zod';

export const vendorMergeSchema = z.object({
  into_vendor_id: z.string().uuid(),
});
export type VendorMerge = z.infer<typeof vendorMergeSchema>;
