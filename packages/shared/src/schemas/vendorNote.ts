import { z } from 'zod';

export const vendorNoteCreateSchema = z.object({
  note_text: z.string().min(1).max(5000),
});
export type VendorNoteCreate = z.infer<typeof vendorNoteCreateSchema>;
