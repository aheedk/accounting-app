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

export type UnifiedResult = {
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

// Single Claude call: classify + extract in one pass.
// If clientContext is provided the AI uses the real chart of accounts instead of a generic fallback list.
export async function classifyAndExtract(pdfBuffer: Buffer, clientContext?: ClientContext): Promise<UnifiedResult> {
  const client = buildAnthropicClient();
  const base64Pdf = pdfBuffer.toString('base64');
  const accountSection = buildCoaPromptSection(clientContext);
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

ACCOUNT SELECTION RULES — follow in this order:
1. CLIENT CODING HISTORY: If the vendor/description matches an entry in the history below, use that same account.
2. ACCOUNTING RULES (override AI for these transaction types):
   - "transfer", "xfer", "wire to", "wire from": use the most appropriate bank/cash account (e.g. Savings Account, Checking Account).
   - Credit card payment (e.g. "Visa payment", "Chase Card", "Amex payment"): use the matching credit card liability account.
   - Payroll / "ADP" / "Gusto" / "Paychex": use Salaries and Wages or Payroll Clearing if available.
   - Loan / mortgage payment: split principal to the loan liability account, interest to Interest Expense if possible; otherwise use Notes Payable.
3. CAPITALIZATION RULE: If the amount is $2,500 or more AND the item is a long-lived tangible asset (equipment, computers/servers, furniture, vehicles, leasehold improvements, HVAC, major renovation) → use a fixed asset account (Equipment, Computer Equipment, Furniture and Fixtures, Vehicles, or Leasehold Improvements).
4. Otherwise: choose the best-matching expense, revenue, or liability account from the list below.

${accountSection}

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
      "suggested_offset": "one account name from the chart of accounts above"
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
      "suggested_account": "one account name from the chart of accounts above"
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

export type CoaAccount = { id: string; name: string; account_type: string };
type VendorMapping = { description: string; account_name: string };

export type ClientContext = {
  coa: CoaAccount[];
  vendorHistory: VendorMapping[];
};

export async function fetchCoa(db: Kysely<DB>, businessId: string): Promise<CoaAccount[]> {
  return db.selectFrom('chart_of_accounts')
    .select(['id', 'name', 'account_type'])
    .where('business_id', '=', businessId)
    .where('is_active', '=', true)
    .orderBy('account_type')
    .orderBy('name')
    .execute();
}

// Pull the last 60 approved bank-statement transactions for this business and build a
// vendor→account mapping so the AI can reuse what the accountant previously accepted.
export async function fetchVendorHistory(db: Kysely<DB>, businessId: string, coa: CoaAccount[]): Promise<VendorMapping[]> {
  const coaMap = new Map(coa.map(a => [a.id, a.name]));
  const rows = await db
    .selectFrom('email_import_staging')
    .select(['extracted_transactions'])
    .where('business_id', '=', businessId)
    .where('status', '=', 'approved')
    .orderBy('created_at', 'desc')
    .limit(10)
    .execute();

  const seen = new Map<string, string>(); // description → account_name
  for (const row of rows) {
    let txs: Array<{ description?: string; suggested_account_id?: string }> = [];
    try { txs = JSON.parse(row.extracted_transactions as unknown as string) as typeof txs; } catch { continue; }
    for (const tx of txs) {
      if (!tx.description || !tx.suggested_account_id) continue;
      const accountName = coaMap.get(tx.suggested_account_id);
      if (!accountName) continue;
      // Normalize: strip leading digits/dates, lowercase, trim
      const key = tx.description.toLowerCase().replace(/^\d[\d/\s-]*/, '').trim().slice(0, 40);
      if (key && !seen.has(key)) seen.set(key, accountName);
    }
  }
  return Array.from(seen.entries()).slice(0, 20).map(([description, account_name]) => ({ description, account_name }));
}

// Exact match first, then substring fuzzy fallback.
export function matchAccount(suggestion: string | undefined, accounts: CoaAccount[]): string | null {
  if (!suggestion?.trim()) return null;
  const hint = suggestion.trim().toLowerCase();
  const exact = accounts.find(a => a.name.toLowerCase() === hint);
  if (exact) return exact.id;
  const partial = accounts.find(a =>
    a.name.toLowerCase().includes(hint) || hint.includes(a.name.toLowerCase()),
  );
  return partial?.id ?? null;
}

// Try the To: header address against businesses.import_email; return the business id + context if found.
async function resolveByEmail(db: Kysely<DB>, toHeader: string): Promise<{ businessId: string; ctx: ClientContext } | null> {
  const emailMatch = toHeader.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  const toAddress = emailMatch?.[0]?.toLowerCase();
  if (!toAddress) return null;
  const byEmail = await db
    .selectFrom('businesses')
    .select('id')
    .where('import_email', '=', toAddress)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!byEmail) return null;
  const coa = await fetchCoa(db, byEmail.id);
  const vendorHistory = await fetchVendorHistory(db, byEmail.id, coa);
  return { businessId: byEmail.id, ctx: { coa, vendorHistory } };
}

// Fall back to AI-extracted name matching when no import_email matched.
export async function resolveByName(db: Kysely<DB>, addressedTo: string | undefined): Promise<string | null> {
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

function buildCoaPromptSection(ctx: ClientContext | undefined): string {
  if (!ctx || ctx.coa.length === 0) {
    // Fallback generic list when no client context is available
    return `Use one of these account names (choose the best fit):
Fixed assets (for tangible items >= $2,500): Equipment, Computer Equipment, Furniture and Fixtures, Vehicles, Leasehold Improvements
Expenses: Salaries and Wages, Rent, Utilities, Office Supplies, Software Subscriptions, Bank Fees, Professional Fees, Travel and Meals, Insurance, Depreciation Expense, Miscellaneous Expense
Revenue: Sales Revenue, Service Revenue
Other: Accounts Receivable, Accounts Payable, Notes Payable, Owner Draws`;
  }

  // Group real accounts by type for a readable prompt
  const byType = new Map<string, string[]>();
  for (const a of ctx.coa) {
    const list = byType.get(a.account_type) ?? [];
    list.push(a.name);
    byType.set(a.account_type, list);
  }
  const sections = Array.from(byType.entries())
    .map(([type, names]) => `${type}: ${names.join(', ')}`)
    .join('\n');

  let history = '';
  if (ctx.vendorHistory.length > 0) {
    history = `\n\nCLIENT CODING HISTORY — how this client previously coded similar transactions (use these first):\n` +
      ctx.vendorHistory.map(v => `"${v.description}" → ${v.account_name}`).join('\n');
  }

  return `Use ONLY account names from the client's chart of accounts below. Do NOT invent names.\n\n${sections}${history}`;
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
  const toHeader = headers.find(h => h.name === 'To')?.value ?? '';
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

  // Pre-resolve business from To: header so we can pass the real CoA to the AI.
  // If the email is addressed to a per-client import alias, we know who it belongs to
  // before running AI — this makes account suggestions much more accurate.
  const earlyResolution = await resolveByEmail(db, toHeader);
  const result = await classifyAndExtract(pdfBuffer, earlyResolution?.ctx);
  const receivedAt = new Date(dateHeader).toISOString();

  if (result.document_type === 'bank_statement') {
    const businessId = earlyResolution?.businessId ?? await resolveByName(db, result.addressed_to);
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
    // Reuse CoA already fetched during email routing; only fetch if needed (AI-name fallback path).
    const coa = earlyResolution?.ctx.coa ?? await fetchCoa(db, businessId);
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
    const businessId = earlyResolution?.businessId ?? await resolveByName(db, result.addressed_to);
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
    // Duplicate check: same vendor + same invoice number already exists (pending or approved)
    const vendor = result.vendor_customer?.trim() ?? null;
    const invoiceNum = result.invoice_number?.trim() ?? null;
    if (vendor && invoiceNum) {
      const duplicate = await db
        .selectFrom('invoice_import_staging')
        .select('id')
        .where('vendor_customer', 'ilike', vendor)
        .where('invoice_number', '=', invoiceNum)
        .where('status', 'in', ['pending', 'approved'])
        .executeTakeFirst();
      if (duplicate) {
        const dupReason = `Duplicate invoice: #${invoiceNum} from "${vendor}" already exists`;
        await db.insertInto('invoice_import_staging').values({
          gmail_message_id: messageId,
          email_from: from,
          email_subject: subject,
          received_at: receivedAt,
          invoice_type: result.invoice_type ?? 'ap',
          vendor_customer: vendor,
          invoice_number: invoiceNum,
          invoice_date: result.invoice_date ?? null,
          due_date: result.due_date ?? null,
          line_items: JSON.stringify(result.line_items ?? []),
          subtotal: result.subtotal ?? null,
          tax_amount: result.tax_amount ?? null,
          total: result.total ?? null,
          addressed_to: result.addressed_to ?? null,
          status: 'rejected',
          rejection_reason: dupReason,
          pdf_data: pdfBuffer,
          business_id: businessId,
        }).onConflict(oc => oc.column('gmail_message_id').doNothing()).execute();
        console.log(`[gmail-worker] message ${messageId} → duplicate invoice rejected: ${dupReason}`);
        return;
      }
    }

    const coa = earlyResolution?.ctx.coa ?? await fetchCoa(db, businessId);
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
      vendor_customer: vendor,
      invoice_number: invoiceNum,
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
    console.log(`[gmail-worker] message ${messageId} → ${(result.invoice_type ?? 'ap').toUpperCase()} invoice for business ${businessId}: ${vendor ?? '(unknown)'} $${result.total ?? '?'}`);
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
