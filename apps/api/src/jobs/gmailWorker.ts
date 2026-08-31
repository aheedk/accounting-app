import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';

const CREDENTIALS_PATH = path.resolve(process.env.GMAIL_CREDENTIALS_PATH ?? 'secrets/gmail-credentials.json');
const TOKEN_PATH = path.join(path.dirname(CREDENTIALS_PATH), 'gmail-token.json');
const GMAIL_LABEL = 'bank-statements';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

import type { OAuth2Client as GAuthClient } from 'google-auth-library';

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

type ExtractedTransaction = {
  date: string;
  description: string;
  amount: string;
  type: 'debit' | 'credit';
  balance: string;
  suggested_offset?: string;
};

async function extractTransactions(pdfBuffer: Buffer): Promise<ExtractedTransaction[]> {
  const client = new Anthropic();
  const base64Pdf = pdfBuffer.toString('base64');
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
        {
          type: 'text',
          text: `Extract all transactions from this bank statement as a JSON array. Return ONLY the JSON array, no explanation.

Each item must have exactly these fields:
- date: "MM/DD/YYYY"
- description: string
- amount: string (positive number only, e.g. "1250.00")
- type: "debit" or "credit"
- balance: string (running balance, e.g. "42500.00")
- suggested_offset: string (best matching GL account name from this list: "Sales Revenue", "Service Revenue", "Sales Returns and Allowances", "Cost of Goods Sold", "Salaries and Wages", "Rent", "Utilities", "Office Supplies", "Software Subscriptions", "Bank Fees", "Professional Fees", "Travel and Meals", "Insurance", "Depreciation Expense", "Miscellaneous Expense", "Accounts Receivable", "Accounts Payable", "Notes Payable", "Owner Draws". Pick the single best match based on the description.)`,
        },
      ] as Anthropic.MessageParam['content'],
    }],
  });

  const content = response.content[0];
  if (!content || content.type !== 'text') return [];
  const match = content.text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as ExtractedTransaction[];
  } catch {
    return [];
  }
}

async function processMessage(
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

  // Find PDF attachment — check both top-level parts and nested parts
  const allParts = [
    ...(msg.data.payload?.parts ?? []),
    ...(msg.data.payload?.parts?.flatMap(p => p.parts ?? []) ?? []),
  ];
  const pdfPart = allParts.find(p =>
    p.mimeType === 'application/pdf' || (p.filename ?? '').endsWith('.pdf'),
  );

  if (!pdfPart?.body?.attachmentId) {
    console.log(`[gmail-worker] message ${messageId} has no PDF attachment, skipping`);
    return;
  }

  const attachment = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: pdfPart.body.attachmentId,
  });

  const base64 = (attachment.data.data ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const pdfBuffer = Buffer.from(base64, 'base64');

  const transactions = await extractTransactions(pdfBuffer);

  await db.insertInto('email_import_staging').values({
    gmail_message_id: messageId,
    email_from: from,
    email_subject: subject,
    received_at: new Date(dateHeader).toISOString(),
    extracted_transactions: JSON.stringify(transactions),
    status: 'pending',
  }).execute();

  console.log(`[gmail-worker] message ${messageId} processed: ${transactions.length} transactions extracted`);
}

async function poll(db: Kysely<DB>): Promise<void> {
  const auth = loadAuth();
  if (!auth) {
    console.log('[gmail-worker] not configured — visit http://localhost:4000/auth/gmail to authorize');
    return;
  }

  const gmail = google.gmail({ version: 'v1', auth });

  // Resolve label ID
  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const label = labelsRes.data.labels?.find(l => l.name === GMAIL_LABEL);
  if (!label?.id) {
    console.log(`[gmail-worker] label "${GMAIL_LABEL}" not found in Gmail account`);
    return;
  }

  const listRes = await gmail.users.messages.list({ userId: 'me', labelIds: [label.id], maxResults: 50 });
  const messages = listRes.data.messages ?? [];

  for (const { id } of messages) {
    if (!id) continue;
    const existing = await db.selectFrom('email_import_staging')
      .where('gmail_message_id', '=', id)
      .select('id')
      .executeTakeFirst();
    if (existing) continue;

    try {
      await processMessage(db, auth, id);
    } catch (e: unknown) {
      console.error(`[gmail-worker] failed to process message ${id}:`, e instanceof Error ? e.message : e);
    }
  }
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
