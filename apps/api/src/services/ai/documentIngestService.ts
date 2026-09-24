import type { Kysely } from 'kysely';
import {
  classifyAndExtract,
  fetchCoa,
  fetchVendorHistory,
  type ClientContext,
} from '../../jobs/gmailWorker.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type IngestResult = {
  kind: 'bank_statement' | 'invoice';
  staging_id: string;
};

/**
 * Ingest a PDF the user uploaded directly, using the same extraction path the
 * Gmail worker runs. Uploads skip the email-routing step entirely: the client
 * is whichever business the user has open, so there is no addressee to resolve.
 *
 * The extraction helpers still live in jobs/gmailWorker.ts, where they grew.
 * They are imported rather than duplicated so the prompt and the client-context
 * builders stay in one place; moving them into this service is a follow-up.
 */
export async function ingestUploadedPdf(
  db: Kysely<DB>,
  ctx: ServiceCtx,
  input: { buffer: Buffer; filename: string },
): Promise<IngestResult> {
  const businessId = ctx.business_id;
  if (!businessId) throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new BusinessRuleError(
      ERR.VALIDATION_FAILED,
      'AI document processing is not configured on this server (ANTHROPIC_API_KEY is not set).',
    );
  }

  const coa = await fetchCoa(db, businessId);
  const clientContext: ClientContext = {
    coa,
    vendorHistory: await fetchVendorHistory(db, businessId, coa),
  };

  const extracted = await classifyAndExtract(input.buffer, clientContext);
  const receivedAt = new Date().toISOString();

  if (extracted.document_type === 'bank_statement') {
    const row = await db.insertInto('email_import_staging').values({
      business_id: businessId,
      gmail_message_id: null,
      source: 'upload',
      uploaded_by_user_id: ctx.user_id,
      original_filename: input.filename,
      email_from: null,
      email_subject: input.filename,
      received_at: receivedAt,
      addressed_to: extracted.addressed_to ?? null,
      extracted_transactions: JSON.stringify(extracted.transactions ?? []),
      status: 'pending',
      pdf_data: input.buffer,
    }).returning('id').executeTakeFirstOrThrow();
    return { kind: 'bank_statement', staging_id: row.id };
  }

  const row = await db.insertInto('invoice_import_staging').values({
    business_id: businessId,
    gmail_message_id: null,
    source: 'upload',
    uploaded_by_user_id: ctx.user_id,
    original_filename: input.filename,
    email_from: null,
    email_subject: input.filename,
    received_at: receivedAt,
    addressed_to: extracted.addressed_to ?? null,
    invoice_type: extracted.invoice_type ?? 'ap',
    vendor_customer: extracted.vendor_customer ?? null,
    invoice_number: extracted.invoice_number ?? null,
    invoice_date: extracted.invoice_date ?? null,
    due_date: extracted.due_date ?? null,
    line_items: JSON.stringify(extracted.line_items ?? []),
    subtotal: extracted.subtotal ?? null,
    tax_amount: extracted.tax_amount ?? null,
    total: extracted.total ?? null,
    status: 'pending',
    pdf_data: input.buffer,
  }).returning('id').executeTakeFirstOrThrow();

  return { kind: 'invoice', staging_id: row.id };
}
