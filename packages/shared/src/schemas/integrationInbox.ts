import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const integrationInboxImportSchema = z.object({
  source: z.enum(['stripe_csv', 'paypal_csv', 'shopify_csv', 'generic']),
  rows: z.array(z.object({
    occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().min(1).max(500),
    amount: moneyStr,
    external_id: z.string().max(200).nullable().optional(),
    raw_payload: z.record(z.unknown()).optional(),
  })).min(1).max(5000),
});
export type IntegrationInboxImport = z.infer<typeof integrationInboxImportSchema>;

export const integrationInboxMatchSchema = z.object({
  journal_entry_id: z.string().uuid(),
});

export const integrationInboxCategorizeSchema = z.object({
  cash_account_id: z.string().uuid(),
  offset_account_id: z.string().uuid(),
  memo: z.string().max(500).nullable().optional(),
});

export const integrationInboxExcludeSchema = z.object({
  excluded_reason: z.string().min(1).max(500),
});
