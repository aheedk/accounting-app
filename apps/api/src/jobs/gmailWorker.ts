import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import type { OAuth2Client as GAuthClient } from 'google-auth-library';

const CREDENTIALS_PATH = path.resolve(process.env.GMAIL_CREDENTIALS_PATH ?? 'secrets/gmail-credentials.json');
const TOKEN_PATH = path.join(path.dirname(CREDENTIALS_PATH), 'gmail-token.json');
const POLL_INTERVAL_MS = 5 * 60 * 1000;

type GmailPart = gmail_v1.Schema$MessagePart;

// Walk the full MIME tree recursively — handles bare attachments, multipart/related, etc.
function findPdfPart(node: GmailPart | null | undefined): GmailPart | undefined {
  if (!node) return undefined;
  if ((node.mimeType === 'application/pdf' || (node.filename ?? '').endsWith('.pdf')) && node.body?.attachmentId) {
    return node;
  }
  for (const child of node.parts ?? []) {
    const found = findPdfPart(child);
    if (found) return found;
  }
  return undefined;
}

function buildOAuth2Client(): GAuthClient {
  const { web } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8')) as {
    web: { client_id: string; client_secret: string; redirect_uris: string[] };
  };
  return new google.auth.OAuth2(web.client_id, web.client_secret, web.redirect_uris[0]);
}

function loadAuth(): GAuthClient | null {
  if (!fs.existsSync(CREDENTIALS_PATH) || !fs.existsSync(TOKEN_PATH)) return null;
  const auth = buildOAuth2Client();
  auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as Record<string, unknown>);
  return auth;
}

// ── Unified extraction types ───────────────────────────────────────────────────

type ExtractedTransaction = {
  date: string;
  description: string;
  amount: string;
  type: 'debit' | 'credit';
  balance: string;
  suggested_offset?: string;
};

type InvoiceLineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  suggested_account?: string;
};

type UnifiedResult = {
  document_type: 'bank_statement' | 'invoice' | 'unknown';
  // bank_statement
  transactions?: ExtractedTransaction[];
  // invoice
  invoice_type?: 'ap' | 'ar';
  vendor_customer?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  subtotal?: string;
  tax_amount?: string;
  total?: string;
  line_items?: InvoiceLineItem[];
};

function buildAnthropicClient(): Anthropic {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  return new Anthropic(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {});
}

// Single Claude call: classify + extract in one pass
async function classifyAndExtract(pdfBuffer: Buffer): Promise<UnifiedResult> {
  const client = buildAnthropicClient();
  const base64Pdf = pdfBuffer.toString('base64');
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
        {
          type: 'text',
          text: `Analyze this document and extract its financial data. Return ONLY a single JSON object, no explanation.

If this is a BANK STATEMENT return:
{
  "document_type": "bank_statement",
  "transactions": [
    {
      "date": "MM/DD/YYYY",
      "description": "string",
      "amount": "positive number e.g. 1250.00",
      "type": "debit or credit",
      "balance": "running balance e.g. 42500.00",
      "suggested_offset": "one of: Sales Revenue, Service Revenue, Cost of Goods Sold, Salaries and Wages, Rent, Utilities, Office Supplies, Software Subscriptions, Bank Fees, Professional Fees, Travel and Meals, Insurance, Depreciation Expense, Miscellaneous Expense, Accounts Receivable, Accounts Payable, Notes Payable, Owner Draws"
    }
  ]
}

If this is an INVOICE or BILL return:
{
  "document_type": "invoice",
  "invoice_type": "ap (we are paying this bill) or ar (customer owes us)",
  "vendor_customer": "vendor name for AP, customer name for AR",
  "invoice_number": "string",
  "invoice_date": "MM/DD/YYYY",
  "due_date": "MM/DD/YYYY",
  "subtotal": "e.g. 1000.00",
  "tax_amount": "e.g. 80.00, use 0.00 if none",
  "total": "e.g. 1080.00",
  "line_items": [
    {
      "description": "string",
      "quantity": "e.g. 2",
      "unit_price": "e.g. 500.00",
      "amount": "e.g. 1000.00",
      "suggested_account": "one of: Sales Revenue, Service Revenue, Cost of Goods Sold, Salaries and Wages, Rent, Utilities, Office Supplies, Software Subscriptions, Bank Fees, Professional Fees, Travel and Meals, Insurance, Depreciation Expense, Miscellaneous Expense"
    }
  ]
}

If the document is neither a bank statement nor an invoice/bill return:
{ "document_type": "unknown" }`,
        },
      ] as Anthropic.MessageParam['content'],
    }],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') return { document_type: 'unknown' };
  const match = content.text.match(/\{[\s\S]*\}/);
  if (!match) return { document_type: 'unknown' };
  try {
    return JSON.parse(match[0]) as UnifiedResult;
  } catch {
    return { document_type: 'unknown' };
  }
}

// Process a single message: download PDF → classify → insert to correct staging table
async function processAnyMessage(
  db: Kysely<DB>,
  auth: GAuthClient,
  messageId: string,
): Promise<void> {
  const gmail = google.gmail({ version: 'v1', auth });
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

  const headers = msg.data.payload?.headers ?? [];
  const subject = headers.find(h => h.name === 'Subject')?.value ?? '';
  const from = headers.find(h => h.name === 'From')?.value ?? '';
  const dateHeader = headers.find(h => h.name === 'Date')?.value ?? new Date().toISOString();

  const pdfPart = findPdfPart(msg.data.payload);
  if (!pdfPart?.body?.attachmentId) {
    console.log(`[gmail-worker] message ${messageId} has no PDF attachment, skipping`);
    return;
  }

  const attachment = await gmail.users.messages.attachments.get({
    userId: 'me', messageId, id: pdfPart.body.attachmentId,
  });

  const base64 = (attachment.data.data ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const pdfBuffer = Buffer.from(base64, 'base64');

  const result = await classifyAndExtract(pdfBuffer);
  const receivedAt = new Date(dateHeader).toISOString();

  if (result.document_type === 'bank_statement') {
    await db.insertInto('email_import_staging').values({
      gmail_message_id: messageId,
      email_from: from,
      email_subject: subject,
      received_at: receivedAt,
      extracted_transactions: JSON.stringify(result.transactions ?? []),
      status: 'pending',
    }).execute();
    console.log(`[gmail-worker] message ${messageId} → bank statement: ${(result.transactions ?? []).length} transactions`);
  } else if (result.document_type === 'invoice') {
    await db.insertInto('invoice_import_staging').values({
      gmail_message_id: messageId,
      email_from: from,
      email_subject: subject,
      received_at: receivedAt,
      invoice_type: result.invoice_type ?? 'ap',
      vendor_customer: result.vendor_customer ?? null,
      invoice_number: result.invoice_number ?? null,
      invoice_date: result.invoice_date ?? null,
      due_date: result.due_date ?? null,
      line_items: JSON.stringify(result.line_items ?? []),
      subtotal: result.subtotal ?? null,
      tax_amount: result.tax_amount ?? null,
      total: result.total ?? null,
      status: 'pending',
    }).execute();
    console.log(`[gmail-worker] message ${messageId} → ${(result.invoice_type ?? 'ap').toUpperCase()} invoice: ${result.vendor_customer ?? '(unknown)'} $${result.total ?? '?'}`);
  } else {
    console.log(`[gmail-worker] message ${messageId} → not a financial document, skipping`);
  }
}

// Query Gmail for all emails with PDF attachments, skip already-processed ones
async function pollAllPdfEmails(db: Kysely<DB>, auth: GAuthClient): Promise<void> {
  const gmail = google.gmail({ version: 'v1', auth });
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'has:attachment filename:pdf',
    maxResults: 50,
  });
  const messages = listRes.data.messages ?? [];

  for (const { id } of messages) {
    if (!id) continue;
    const [bankSeen, invSeen] = await Promise.all([
      db.selectFrom('email_import_staging').where('gmail_message_id', '=', id).select('id').executeTakeFirst(),
      db.selectFrom('invoice_import_staging').where('gmail_message_id', '=', id).select('id').executeTakeFirst(),
    ]);
    if (bankSeen ?? invSeen) continue;
    try {
      await processAnyMessage(db, auth, id);
    } catch (e: unknown) {
      console.error(`[gmail-worker] failed to process message ${id}:`, e instanceof Error ? e.message : e);
    }
  }
}

async function poll(db: Kysely<DB>): Promise<void> {
  const auth = loadAuth();
  if (!auth) {
    console.log('[gmail-worker] not configured — visit http://localhost:4000/auth/gmail to authorize');
    return;
  }
  await pollAllPdfEmails(db, auth);
}

export async function triggerPoll(db: Kysely<DB>): Promise<void> {
  await poll(db);
}

export function startGmailWorker(db: Kysely<DB>): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[gmail-worker] ANTHROPIC_API_KEY not set, worker disabled');
    return;
  }

  const tick = async (): Promise<void> => {
    try {
      await poll(db);
    } catch (e: unknown) {
      console.error('[gmail-worker] tick crashed:', e instanceof Error ? e.message : e);
    }
  };

  void tick();
  setInterval(() => void tick(), POLL_INTERVAL_MS);
  console.log('[gmail-worker] started — polling every 5 minutes');
}
