import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { DB } from '../../db/types.js';
import { schemas } from '@accounting/shared';
import { callClaudeWithTool, type ChatHistoryMessage } from './chatLlm.js';
import { buildSchemaContext, buildCoaPromptSection, buildContactsPromptSection } from './chatSchemaContext.js';
import Anthropic from '@anthropic-ai/sdk';

const TOOL_NAME = 'prepare_transaction';

// Claude's strict tool-use mode supports neither `oneOf` nor `anyOf` at the
// schema level (both confirmed live: "Schema type 'oneOf' is not
// supported"), so a real discriminated-union JSON schema matching
// chat.ts's chatActionPayloadSchema one-for-one isn't an option here. This
// is deliberately flat instead — one `action_type` enum plus every field
// any of the 4 transaction types might need, all but `action_type`/`lines`
// optional — and `toActionPayload` below picks out just the fields the
// chosen type actually uses and re-validates the result against the real
// `chatActionPayloadSchema`, so the discriminated-union guarantee still
// holds at the TypeScript boundary even though the wire schema sent to
// Claude is flat.
const ACTION_INPUT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    action_type: { type: 'string', enum: ['journal_entry', 'expense', 'invoice', 'deposit'] },
    date: { type: 'string', description: 'ISO date YYYY-MM-DD — the entry/expense/issue/deposit date' },
    due_date: { type: 'string', description: 'ISO date YYYY-MM-DD — invoices only' },
    memo: { type: 'string' },
    payment_account_id: { type: ['string', 'null'], description: 'expense only — the real bank/cash account uuid it was paid from' },
    vendor_id: { type: ['string', 'null'], description: 'expense only' },
    vendor_name: { type: 'string', description: 'expense only' },
    customer_id: { type: ['string', 'null'], description: 'invoice only' },
    customer_name: { type: 'string', description: 'invoice only' },
    deposit_to_account_id: { type: ['string', 'null'], description: 'deposit only — the real bank account uuid' },
    lines: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          account_id: { type: ['string', 'null'], description: 'journal_entry/expense/deposit — the real account uuid, or null if no confident match' },
          account_name: { type: 'string', description: 'journal_entry/expense/deposit' },
          debit: { type: 'number', description: 'journal_entry only' },
          credit: { type: 'number', description: 'journal_entry only' },
          amount: { type: 'number', description: 'expense/deposit only' },
          description: { type: 'string' },
          quantity: { type: 'number', description: 'invoice only' },
          unit_price: { type: 'number', description: 'invoice only' },
          revenue_account_id: { type: ['string', 'null'], description: 'invoice only — the real income account uuid this line is earned to, or null if no confident match' },
        },
        required: [],
      },
    },
    // A one-sentence note on anything it couldn't match (an account or
    // contact name with no confident match) — folded into the chat reply,
    // not silently dropped.
    unmatched_note: { type: 'string' },
  },
  required: ['action_type', 'date', 'lines'],
};

const flatResultSchema = z.object({
  action_type: z.enum(['journal_entry', 'expense', 'invoice', 'deposit']),
  date: z.string(),
  due_date: z.string().optional(),
  memo: z.string().optional(),
  payment_account_id: z.string().nullable().optional(),
  vendor_id: z.string().nullable().optional(),
  vendor_name: z.string().optional(),
  customer_id: z.string().nullable().optional(),
  customer_name: z.string().optional(),
  deposit_to_account_id: z.string().nullable().optional(),
  lines: z.array(z.object({
    account_id: z.string().nullable().optional(),
    account_name: z.string().optional(),
    debit: z.number().optional(),
    credit: z.number().optional(),
    amount: z.number().optional(),
    description: z.string().optional(),
    quantity: z.number().optional(),
    unit_price: z.number().optional(),
    revenue_account_id: z.string().nullable().optional(),
  })),
  unmatched_note: z.string().optional(),
});
type FlatResult = z.infer<typeof flatResultSchema>;

/** Picks out the fields `action_type` actually needs and re-validates
 * against the real discriminated union — see the schema comment above. */
function toActionPayload(flat: FlatResult): schemas.ChatActionPayload | null {
  const candidate = (() => {
    switch (flat.action_type) {
      case 'journal_entry':
        return {
          type: 'journal_entry' as const,
          data: {
            date: flat.date ?? '',
            ...(flat.memo !== undefined ? { memo: flat.memo } : {}),
            lines: flat.lines.map(l => ({
              account_id: l.account_id ?? null,
              account_name: l.account_name ?? '',
              ...(l.debit !== undefined ? { debit: l.debit } : {}),
              ...(l.credit !== undefined ? { credit: l.credit } : {}),
              ...(l.description !== undefined ? { description: l.description } : {}),
            })),
          },
        };
      case 'expense':
        return {
          type: 'expense' as const,
          data: {
            date: flat.date ?? '',
            payment_account_id: flat.payment_account_id ?? null,
            ...(flat.vendor_id !== undefined ? { vendor_id: flat.vendor_id } : {}),
            ...(flat.vendor_name !== undefined ? { vendor_name: flat.vendor_name } : {}),
            ...(flat.memo !== undefined ? { memo: flat.memo } : {}),
            lines: flat.lines.map(l => ({
              account_id: l.account_id ?? null,
              account_name: l.account_name ?? '',
              amount: l.amount ?? 0,
              ...(l.description !== undefined ? { description: l.description } : {}),
            })),
          },
        };
      case 'invoice':
        return {
          type: 'invoice' as const,
          data: {
            customer_id: flat.customer_id ?? null,
            customer_name: flat.customer_name ?? '',
            date: flat.date ?? '',
            due_date: flat.due_date ?? '',
            ...(flat.memo !== undefined ? { memo: flat.memo } : {}),
            lines: flat.lines.map(l => ({
              description: l.description ?? '',
              quantity: l.quantity ?? 0,
              unit_price: l.unit_price ?? 0,
              revenue_account_id: l.revenue_account_id ?? null,
            })),
          },
        };
      case 'deposit':
        return {
          type: 'deposit' as const,
          data: {
            date: flat.date ?? '',
            deposit_to_account_id: flat.deposit_to_account_id ?? null,
            ...(flat.memo !== undefined ? { memo: flat.memo } : {}),
            lines: flat.lines.map(l => ({
              account_id: l.account_id ?? null,
              account_name: l.account_name ?? '',
              amount: l.amount ?? 0,
              ...(l.description !== undefined ? { description: l.description } : {}),
            })),
          },
        };
    }
  })();
  const parsed = schemas.chatActionPayloadSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const SYSTEM_PROMPT = `You prepare draft accounting transactions from a user's request, for the user to review and save themselves — you never save anything yourself.

Match every account name the user mentions to a real account from the chart of accounts list below (fuzzy match is fine — "rent" matches "Rent Expense"). Match every vendor/customer name to a real contact from the contacts list. If you cannot find a confident match for an account or contact, set its id field to null and name it in "unmatched_note" — never invent an id.

Every line of every transaction MUST have a nonzero amount — never leave debit/credit/amount blank. A journal entry needs at least 2 lines whose debit/credit amounts actually sum to equal totals (e.g. a single $500 expense is one line debiting the expense account $500 and one line crediting the cash/bank account $500 — not two lines with no amount). An expense needs a payment account and at least one line, each with a dollar amount. An invoice needs a customer and at least one line with quantity, unit price, and a revenue_account_id matched from the chart of accounts (an income-type account — if none is clearly implied, use the business's default/general income account; set null and note it in unmatched_note only if there's truly no income account to pick). A deposit needs a deposit-to account and at least one line with an amount.

Always set "date" — if the user doesn't give one, use today, {{today}}. For an invoice, always set "due_date" too: if the user gives payment terms like "net 30", compute due_date as date + that many days yourself (don't leave it blank); if they give no terms at all, default to net 30 from date.

Chart of accounts (id | code — name (type)):
{{coa}}

Customers and vendors (id | name (kind)):
{{contacts}}`;

export async function buildActionPayload(
  db: Kysely<DB>,
  businessId: string,
  history: ChatHistoryMessage[],
  client: Anthropic | undefined,
): Promise<{ action: schemas.ChatActionPayload | null; note: string | null }> {
  const [coa, contacts] = await Promise.all([
    buildCoaPromptSection(db, businessId),
    buildContactsPromptSection(db, businessId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const system = SYSTEM_PROMPT
    .replace('{{today}}', today)
    .replace('{{coa}}', coa)
    .replace('{{contacts}}', contacts)
    + '\n\n' + buildSchemaContext();

  const result = await callClaudeWithTool({
    system,
    history,
    toolName: TOOL_NAME,
    toolDescription: 'Return a structured draft of the transaction the user asked to create, with every account/contact name resolved to a real id where possible.',
    toolInputSchema: ACTION_INPUT_SCHEMA,
    zodSchema: flatResultSchema,
    client,
  });
  return { action: toActionPayload(result), note: result.unmatched_note ?? null };
}
