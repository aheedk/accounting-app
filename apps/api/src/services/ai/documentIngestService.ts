import type { Kysely } from 'kysely';
import Anthropic from '@anthropic-ai/sdk';
import {
  classifyAndExtract,
  ExtractionTooLongError,
  fetchCoa,
  fetchVendorHistory,
  type ClientContext,
  type DocumentMediaType,
} from '../../jobs/gmailWorker.js';
import { normalizeCardLines, splitByAccount, type RawCardLine } from './statementImportService.js';
import { saveCheckStubs } from './checkStubService.js';
import { uploadFile } from '../files/fileService.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type IngestResult =
  | { kind: 'bank_statement' | 'credit_card_statement'; staging_id: string; statement_count: number }
  | { kind: 'invoice'; staging_id: string }
  | { kind: 'check_stubs'; check_count: number };

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
  input: { buffer: Buffer; filename: string; media_type?: DocumentMediaType },
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

  let extracted: Awaited<ReturnType<typeof classifyAndExtract>>;
  try {
    extracted = await classifyAndExtract(input.buffer, clientContext, input.media_type ?? 'application/pdf');
  } catch (e: unknown) {
    // A rejected key otherwise surfaces as a bare "Internal server error".
    if (e instanceof Anthropic.AuthenticationError) {
      throw new BusinessRuleError(
        ERR.VALIDATION_FAILED,
        'AI document processing is unavailable: the Anthropic API key on this server was rejected. Update ANTHROPIC_API_KEY and restart the API.',
      );
    }
    if (e instanceof ExtractionTooLongError) {
      throw new BusinessRuleError(
        ERR.VALIDATION_FAILED,
        `"${input.filename}" has more transactions than can be read in one pass. Split the PDF (for example one account or half a month per file) and upload the parts.`,
      );
    }
    throw e;
  }
  const receivedAt = new Date().toISOString();

  if (extracted.document_type === 'unknown') {
    throw new BusinessRuleError(
      ERR.VALIDATION_FAILED,
      `"${input.filename}" was not recognised as a bank or credit card statement, check stubs, or an invoice.`,
    );
  }

  if (extracted.document_type === 'check_stubs') {
    // The stub image is kept so the accountant can look at it later.
    const checks = extracted.checks ?? [];
    const count = await db.transaction().execute(async trx => {
      const file = await uploadFile(trx, ctx, {
        business_id: businessId,
        original_name: input.filename,
        mime_type: input.media_type ?? 'application/pdf',
        buffer: input.buffer,
      });
      const saved = await saveCheckStubs(trx, ctx, {
        checks,
        source_file_id: file.id,
        source_filename: input.filename,
      });
      return saved.length;
    });
    if (count === 0) {
      throw new BusinessRuleError(ERR.VALIDATION_FAILED, `No checks could be read from "${input.filename}".`);
    }
    return { kind: 'check_stubs', check_count: count };
  }

  if (extracted.document_type === 'bank_statement' || extracted.document_type === 'credit_card_statement') {
    const isCard = extracted.document_type === 'credit_card_statement';
    const parts = isCard
      ? [{
          account_hint: [extracted.card_name, extracted.card_last4].filter(Boolean).join(' ') || null,
          lines: normalizeCardLines((extracted.transactions ?? []) as unknown as RawCardLine[]),
        }]
      : splitByAccount(extracted.transactions ?? [], extracted.accounts);
    const ids = await db.transaction().execute(async trx => {
      const out: string[] = [];
      for (const part of parts) {
        const row = await trx.insertInto('email_import_staging').values({
          business_id: businessId,
          gmail_message_id: null,
          source: 'upload',
          uploaded_by_user_id: ctx.user_id,
          original_filename: input.filename,
          email_from: null,
          email_subject: input.filename,
          received_at: receivedAt,
          addressed_to: extracted.addressed_to ?? null,
          extracted_transactions: JSON.stringify(part.lines),
          statement_kind: isCard ? 'credit_card' : 'bank',
          account_hint: part.account_hint,
          status: 'pending',
          pdf_data: input.buffer,
        }).returning('id').executeTakeFirstOrThrow();
        out.push(row.id);
      }
      return out;
    });
    return { kind: isCard ? 'credit_card_statement' : 'bank_statement', staging_id: ids[0]!, statement_count: ids.length };
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
