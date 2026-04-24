import { z } from 'zod';

export const receiptLinkSchema = z.object({
  linked_entity_type: z.enum([
    'bank_transaction', 'bill', 'expense_transaction', 'invoice', 'journal_entry', 'unlinked',
  ]),
  linked_entity_id: z.string().uuid().nullable().optional(),
}).refine(
  v => (v.linked_entity_type === 'unlinked') === (v.linked_entity_id == null),
  { message: 'unlinked requires null linked_entity_id; linked types require a uuid' },
);
export type ReceiptLink = z.infer<typeof receiptLinkSchema>;
