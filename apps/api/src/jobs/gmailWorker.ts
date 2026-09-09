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
  // which client business this document belongs to (BILL TO / account holder)
  addressed_to?: string;
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

CAPITALIZATION RULE (apply to every line item and transaction):
- If the amount is $2,500 or more AND the item is a long-lived tangible asset (equipment, machinery, computers/servers, furniture, vehicles, leasehold improvements, HVAC, major renovations), use a FIXED ASSET account from the list below instead of an expense account.
- Fixed asset accounts: Equipment, Computer Equipment, Furniture and Fixtures, Vehicles, Leasehold Improvements
- Expense accounts (for items under $2,500 OR consumable/recurring costs): Sales Revenue, Service Revenue, Cost of Goods Sold, Salaries and Wages, Rent, Utilities, Office Supplies, Software Subscriptions, Bank Fees, Professional Fees, Travel and Meals, Insurance, Depreciation Expense, Miscellaneous Expense, Accounts Receivable, Accounts Payable, Notes Payable, Owner Draws

If this is a BANK STATEMENT return:
{
  "document_type": "bank_statement",
  "addressed_to": "exact name of the account holder / company this statement belongs to",
  "transactions": [
    {
      "date": "MM/DD/YYYY",
      "description": "string",
      "amount": "positive number e.g. 1250.00",
      "type": "debit or credit",
      "balance": "running balance e.g. 42500.00",
      "suggested_offset": "one account name from the lists above — use a fixed asset account if amount >= $2,500 and it is a tangible long-lived asset"
    }
  ]
}

If this is an INVOICE or BILL return:
{
  "document_type": "invoice",
  "addressed_to": "exact name from the BILL TO / SOLD TO / Ship To field — the company receiving / paying this document",
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
      "suggested_account": "one account name from the lists above — use a fixed asset account if amount >= $2,500 and it is a tangible long-lived asset"
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

type CoaAccount = { id: string; name: string; account_type: string };

// Fetch the CoA for a business and match a suggestion string to the best account id.
async function fetchCoa(db: Kysely<DB>, businessId: string): Promise<CoaAccount[]> {
  return db.selectFrom('chart_of_accounts')
    .select(['id', 'name', 'account_type'])
    .where('business_id', '=', businessId)
    .where('is_active', '=', true)
    .execute();
}

function matchAccount(suggestion: string | undefined, accounts: CoaAccount[]): string | null {
  if (!suggestion?.trim()) return null;
  const hint = suggestion.trim().toLowerCase();
  const match = accounts.find(a =>
    a.name.toLowerCase().includes(hint) || hint.includes(a.name.toLowerCase()),
  );
  return match?.id ?? null;
}

// Resolve business_id by matching the extracted "addressed_to" name against businesses.
// Uses case-insensitive substring match so "Green Gadgets" matches "Green Gadgets Inc."
async function resolveBusinessId(
  db: Kysely<DB>,
  addressedTo: string | undefined,
): Promise<string | null> {
  if (!addressedTo?.trim()) return null;
  const needle = addressedTo.trim().toLowerCase();
  const businesses = await db
    .selectFrom('businesses')
    .select(['id', 'name'])
    .where('deleted_at', 'is', null)
    .execute();
  const match = businesses.find(b =>
    b.name.toLowerCase().includes(needle) || needle.includes(b.name.toLowerCase()),
  );
  return match?.id ?? null;
}

// Process a single message: download PDF → classify → match business → insert to correct staging table
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
    const businessId = await resolveBusinessId(db, result.addressed_to);
    if (!businessId) {
      const reason = result.addressed_to
        ? `No business found matching "${result.addressed_to}"`
        : 'Document has no identifiable company name';
      await db.insertInto('email_import_staging').values({
        gmail_message_id: messageId,
        email_from: from,
        email_subject: subject,
        received_at: receivedAt,
        extracted_transactions: JSON.stringify(result.transactions ?? []),
        addressed_to: result.addressed_to ?? null,
        pdf_data: pdfBuffer,
        status: 'rejected',
        rejection_reason: reason,
      }).onConflict(oc => oc.column('gmail_message_id').doNothing()).execute();
      console.log(`[gmail-worker] message ${messageId} → bank statement auto-rejected: ${reason}`);
      return;
    }
    const coa = await fetchCoa(db, businessId);
    const enrichedTxs = (result.transactions ?? []).map(tx => ({
      ...tx,
      suggested_account_id: matchAccount(tx.suggested_offset, coa),
    }));
    await db.insertInto('email_import_staging').values({
      gmail_message_id: messageId,
      email_from: from,
      email_subject: subject,
      received_at: receivedAt,
      extracted_transactions: JSON.stringify(enrichedTxs),
      addressed_to: result.addressed_to ?? null,
      pdf_data: pdfBuffer,
      business_id: businessId,
      status: 'pending',
    }).onConflict(oc => oc.column('gmail_message_id').doNothing()).execute();
    console.log(`[gmail-worker] message ${messageId} → bank statement for business ${businessId}: ${enrichedTxs.length} transactions`);
  } else if (result.document_type === 'invoice') {
    const businessId = await resolveBusinessId(db, result.addressed_to);
    if (!businessId) {
      const reason = result.addressed_to
        ? `No business found matching "${result.addressed_to}"`
        : 'Document has no identifiable company name';
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
        addressed_to: result.addressed_to ?? null,
        status: 'rejected',
        rejection_reason: reason,
        pdf_data: pdfBuffer,
      }).onConflict(oc => oc.column('gmail_message_id').doNothing()).execute();
      console.log(`[gmail-worker] message ${messageId} → invoice auto-rejected: ${reason}`);
      return;
    }
    const coa = await fetchCoa(db, businessId);
    const enrichedLines = (result.line_items ?? []).map(li => ({
      ...li,
      suggested_account_id: matchAccount(li.suggested_account, coa),
    }));
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
      line_items: JSON.stringify(enrichedLines),
      subtotal: result.subtotal ?? null,
      tax_amount: result.tax_amount ?? null,
      total: result.total ?? null,
      addressed_to: result.addressed_to ?? null,
      pdf_data: pdfBuffer,
      business_id: businessId,
      status: 'pending',
    }).onConflict(oc => oc.column('gmail_message_id').doNothing()).execute();
    console.log(`[gmail-worker] message ${messageId} → ${(result.invoice_type ?? 'ap').toUpperCase()} invoice for business ${businessId}: ${result.vendor_customer ?? '(unknown)'} $${result.total ?? '?'}`);
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
