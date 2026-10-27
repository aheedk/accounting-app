import { z } from 'zod';

// camelCase to match the response's own `conversationId` — found live: a
// snake_case request field here while the response used camelCase meant a
// client passing the conversationId straight back (the documented,
// obvious thing to do) silently started a new conversation every time
// instead of continuing the old one.
export const chatMessageRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});
export type ChatMessageRequest = z.infer<typeof chatMessageRequestSchema>;

export const chatIntentSchema = z.enum(['query', 'action', 'insight', 'help']);
export type ChatIntent = z.infer<typeof chatIntentSchema>;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// `account_id`/`vendor_id`/`customer_id` are nullable, not required uuids —
// the brief is explicit that an unmatched name must be left empty and
// surfaced in the reply ("If it can't find a match, leave the field empty"),
// which a bare `.uuid()` can't represent (an empty string isn't a valid one).

const journalLineSchema = z.object({
  account_id: z.string().uuid().nullable(),
  account_name: z.string(),
  debit: z.number().nonnegative().optional(),
  credit: z.number().nonnegative().optional(),
  description: z.string().optional(),
});

// Plain ZodObject, no `.refine()` here — z.discriminatedUnion (below) needs
// a raw object per branch to find the `type` discriminator; wrapping this in
// `.refine()` would turn it into a ZodEffects the union can't introspect.
// The "every line has an amount, debits equal credits" check is applied
// after the union is built instead (chatActionPayloadSchema's own
// `.superRefine`), where it can run for the journal_entry branch only.
export const journalEntryActionSchema = z.object({
  type: z.literal('journal_entry'),
  data: z.object({
    date: dateString,
    memo: z.string().optional(),
    lines: z.array(journalLineSchema).min(2),
  }),
});
export type JournalEntryAction = z.infer<typeof journalEntryActionSchema>;

const expenseLineSchema = z.object({
  account_id: z.string().uuid().nullable(),
  account_name: z.string(),
  amount: z.number().positive(),
  description: z.string().optional(),
});

export const expenseActionSchema = z.object({
  type: z.literal('expense'),
  data: z.object({
    date: dateString,
    payment_account_id: z.string().uuid().nullable(),
    vendor_id: z.string().uuid().nullable().optional(),
    vendor_name: z.string().optional(),
    memo: z.string().optional(),
    lines: z.array(expenseLineSchema).min(1),
  }),
});
export type ExpenseAction = z.infer<typeof expenseActionSchema>;

// `revenue_account_id` isn't in the brief's own InvoiceAction sketch, but
// the real invoice-creation endpoint (invoiceLineInputSchema in this same
// package) requires one per line — found live: without it, the model
// correctly refuses to produce a draft at all rather than hand back
// something the real create form can't actually submit. Nullable, same
// "leave it empty and say so" pattern as every other account/contact id
// here, rather than required.
const invoiceLineSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
  revenue_account_id: z.string().uuid().nullable(),
});

export const invoiceActionSchema = z.object({
  type: z.literal('invoice'),
  data: z.object({
    customer_id: z.string().uuid().nullable(),
    customer_name: z.string(),
    date: dateString,
    due_date: dateString,
    memo: z.string().optional(),
    lines: z.array(invoiceLineSchema).min(1),
  }),
});
export type InvoiceAction = z.infer<typeof invoiceActionSchema>;

const depositLineSchema = z.object({
  account_id: z.string().uuid().nullable(),
  account_name: z.string(),
  amount: z.number().positive(),
  description: z.string().optional(),
});

export const depositActionSchema = z.object({
  type: z.literal('deposit'),
  data: z.object({
    date: dateString,
    deposit_to_account_id: z.string().uuid().nullable(),
    memo: z.string().optional(),
    lines: z.array(depositLineSchema).min(1),
  }),
});
export type DepositAction = z.infer<typeof depositActionSchema>;

export const chatActionPayloadSchema = z.discriminatedUnion('type', [
  journalEntryActionSchema,
  expenseActionSchema,
  invoiceActionSchema,
  depositActionSchema,
]).superRefine((action, ctx) => {
  // Caught live: the model's first real response left every line's debit
  // and credit entirely blank — a journal entry pre-fill with no amounts
  // isn't useful to review. Enforced here (not on journalEntryActionSchema
  // itself — see its own comment on why) so a malformed draft fails to
  // validate and the chat service reports "I couldn't put together a
  // transaction from that" instead of handing the user an empty shell.
  if (action.type !== 'journal_entry') return;
  const lines = action.data.lines;
  if (!lines.every(l => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'every journal entry line needs a nonzero debit or credit' });
  }
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'total debits must equal total credits' });
  }
});
export type ChatActionPayload = z.infer<typeof chatActionPayloadSchema>;

export const chatMessageResponseSchema = z.object({
  reply: z.string(),
  conversationId: z.string().uuid(),
  action: chatActionPayloadSchema.optional(),
  data: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type ChatMessageResponse = z.infer<typeof chatMessageResponseSchema>;
