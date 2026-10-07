import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT, ERR, SUSPENSE_DETAIL_TYPE } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { updateExpense } from '../ap/expenseTransactionService.js';
import { updateImportedTransaction } from '../banking/importedTransactionService.js';
import { suggestFromContext, type CodingContext } from './autoCodingService.js';

// Check stubs (the client's checkbook stubs, register, or check images) name
// the payee and purpose of checks that bank statements show only as
// "CHECK 1042". Spec: docs/specs/2026-10-04-card-statements-and-check-stubs-design.md

export type ExtractedCheck = {
  check_number?: string;
  date?: string;
  payee_name?: string;
  amount?: string;
  memo?: string;
  suggested_account?: string;
};

export type CheckStubRow = {
  id: string;
  check_number: string | null;
  check_date: string | null;
  payee_name: string | null;
  amount: string;
  memo: string | null;
  suggested_account_name: string | null;
  suggested_account_id: string | null;
  status: 'unmatched' | 'matched' | 'dismissed';
  matched_journal_entry_id: string | null;
  source_filename: string | null;
  source_file_id: string | null;
  created_at: string;
};

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/** Amounts compared to the cent, whatever the source's formatting. */
function cents(amount: string | number): number {
  return Math.round(Math.abs(Number(String(amount).replace(/[$,]/g, ''))) * 100);
}

function cleanCheckNumber(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  return digits || null;
}

/**
 * "MM/DD/YYYY" or ISO to ISO; anything unreadable to null. Handwritten stubs
 * often say just "7/1": that is taken as the most recent 7/1 (allowing a month
 * of post-dating), not a year the model guessed.
 */
export function toIsoDate(value: string | null | undefined, today: Date = new Date()): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(value.trim());
  if (!us) return null;
  const month = us[1]!.padStart(2, '0');
  const day = us[2]!.padStart(2, '0');
  let year: number;
  if (us[3]) {
    year = Number(us[3].length === 2 ? `20${us[3]}` : us[3]);
  } else {
    year = today.getUTCFullYear();
    const latest = Date.UTC(year, today.getUTCMonth(), today.getUTCDate() + 31);
    if (Date.UTC(year, Number(month) - 1, Number(day)) > latest) year -= 1;
  }
  return `${year}-${month}-${day}`;
}

function normalizeAccountName(name: string): string {
  return name.toLowerCase().replace(/^[\d\s.-]+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Words that say nothing about what a check paid for.
const FILLER_WORDS = new Set([
  'and', 'the', 'for', 'of', 'to', 'expense', 'expenses', 'payment', 'payments', 'cost', 'costs', 'misc', 'inv', 'invoice',
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june', 'jul', 'july',
  'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november', 'dec', 'december',
]);

function meaningfulWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ')
    .filter(word => word.length > 2 && !FILLER_WORDS.has(word))
    .map(word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word));
}

/**
 * The one expense account whose name shares the most words with the text
 * ("food" -> "Food Purchases", "Meals and Entertainment" -> "Meals & Entertainment").
 * Two accounts that fit equally well means not sure, so neither is picked.
 */
function expenseAccountByWords(accounts: CodingContext['accounts'], text: string): string | null {
  const wanted = meaningfulWords(text);
  if (wanted.length === 0) return null;
  const scored = accounts
    .filter(account => account.account_type === 'expense' && account.detail_type !== SUSPENSE_DETAIL_TYPE)
    .map(account => {
      const name = meaningfulWords(account.name);
      return { id: account.id, score: wanted.filter(word => name.includes(word)).length, extra: name.length };
    })
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.extra - b.extra);
  const [best, next] = scored;
  if (!best) return null;
  if (next && next.score === best.score && next.extra === best.extra) return null;
  return best.id;
}

/**
 * The category a stub points a check to, most trusted source first:
 *  1. how this client codes the payee (a learned rule, or the vendor's default account);
 *  2. the account the AI read off the stub;
 *  3. how the payee was coded before;
 *  4. an expense account named like the AI's suggestion or the stub's memo.
 * Null when none of them say, which leaves the check for Suspense.
 */
export function stubCategory(
  context: CodingContext,
  stub: Pick<CheckStubRow, 'payee_name' | 'memo' | 'amount' | 'suggested_account_name' | 'suggested_account_id'>,
): { account_id: string; confidence: number } | null {
  const byPayee = stub.payee_name
    ? suggestFromContext(context, { description: stub.payee_name, amount: stub.amount, direction: 'debit' })
    : null;
  const payeeAccount = byPayee?.lines[0]?.account_id;
  // The engine's accounting rules read bank wording ("transfer", "loan"), not payee names, so they are not used here.
  const layer = byPayee?.source_layer;
  if (byPayee && payeeAccount && (layer === 'learned_rule' || layer === 'vendor_default')) {
    return { account_id: payeeAccount, confidence: byPayee.confidence };
  }
  if (stub.suggested_account_id && context.accountIds.has(stub.suggested_account_id)) {
    return { account_id: stub.suggested_account_id, confidence: 88 };
  }
  if (byPayee && payeeAccount && layer === 'history') return { account_id: payeeAccount, confidence: byPayee.confidence };

  for (const text of [stub.suggested_account_name, stub.memo]) {
    const account = text ? expenseAccountByWords(context.accounts, text) : null;
    if (account) return { account_id: account, confidence: 75 };
  }
  return null;
}

/** Save the checks read from one uploaded stub document. */
export async function saveCheckStubs(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: {
    checks: ExtractedCheck[];
    source_file_id: string | null;
    source_filename: string | null;
    gmail_message_id?: string | null;
  },
): Promise<CheckStubRow[]> {
  const businessId = ctx.business_id;
  if (!businessId) throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  const usable = input.checks.filter(check => cents(check.amount ?? 0) > 0);
  if (usable.length === 0) return [];

  const accounts = await trx.selectFrom('chart_of_accounts').select(['id', 'name'])
    .where('business_id', '=', businessId)
    .where('is_active', '=', true)
    .execute();
  const byName = new Map(accounts.map(account => [normalizeAccountName(account.name), account.id]));

  const rows = await trx.insertInto('check_stubs').values(usable.map(check => ({
    business_id: businessId,
    check_number: cleanCheckNumber(check.check_number),
    check_date: toIsoDate(check.date),
    payee_name: check.payee_name?.trim() || null,
    amount: (cents(check.amount ?? 0) / 100).toFixed(2),
    memo: check.memo?.trim() || null,
    suggested_account_name: check.suggested_account?.trim() || null,
    suggested_account_id: check.suggested_account
      ? byName.get(normalizeAccountName(check.suggested_account)) ?? null
      : null,
    source_file_id: input.source_file_id,
    source_filename: input.source_filename,
    gmail_message_id: input.gmail_message_id ?? null,
    // The email poller runs as the system user, which has no users row.
    uploaded_by_user_id: ctx.user_id === SYSTEM_USER_ID ? null : ctx.user_id,
  }))).returningAll().execute();

  for (const row of rows) {
    await auditRecord(trx, ctx, {
      action: AUDIT.CHECK_STUB_CREATE, entity_type: 'check_stub', entity_id: row.id, before: null, after: row,
    });
  }
  return rows.map(toStubRow);
}

type StubDbRow = Awaited<ReturnType<typeof loadStub>>;

async function loadStub(db: Kysely<DB> | Transaction<DB>, businessId: string, id: string) {
  return db.selectFrom('check_stubs').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', businessId)
    .executeTakeFirst();
}

function toStubRow(row: NonNullable<StubDbRow>): CheckStubRow {
  return {
    id: row.id,
    check_number: row.check_number,
    check_date: row.check_date ? String(row.check_date).slice(0, 10) : null,
    payee_name: row.payee_name,
    amount: Number(row.amount).toFixed(2),
    memo: row.memo,
    suggested_account_name: row.suggested_account_name,
    suggested_account_id: row.suggested_account_id,
    status: row.status,
    matched_journal_entry_id: row.matched_journal_entry_id,
    source_filename: row.source_filename,
    source_file_id: row.source_file_id,
    created_at: new Date(row.created_at as unknown as string | Date).toISOString(),
  };
}

/** A stub is used once: mark it as the record behind this posted entry. */
export async function markCheckStubMatched(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { stub_id: string; journal_entry_id: string; amount: string },
): Promise<void> {
  const businessId = ctx.business_id;
  if (!businessId) throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  const before = await trx.selectFrom('check_stubs').selectAll()
    .where('id', '=', input.stub_id)
    .where('business_id', '=', businessId)
    .forUpdate()
    .executeTakeFirst();
  if (!before) throw new BusinessRuleError(ERR.NOT_FOUND, 'Check stub not found');
  if (before.status !== 'unmatched') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'This check stub has already been used');
  }
  if (cents(before.amount) !== cents(input.amount)) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'The check stub amount does not match this check');
  }
  const after = await trx.updateTable('check_stubs').set({
    status: 'matched',
    matched_journal_entry_id: input.journal_entry_id,
    matched_at: sql`now()`,
    matched_by_user_id: ctx.user_id,
  }).where('id', '=', before.id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.CHECK_STUB_MATCH, entity_type: 'check_stub', entity_id: before.id, before, after,
  });
}

export type StubCandidateLine = {
  index: number;
  check_number: string | null;
  amount: string;
  /** ISO date of the statement line. */
  date: string;
  is_check: boolean;
};

const AMOUNT_ONLY_WINDOW_DAYS = 60;

/**
 * Pair statement check lines with unmatched stubs. A check number must agree
 * and so must the amount, to the cent. A line with no check number matches on
 * amount only when exactly one unmatched stub, dated within 60 days, has it.
 * Each stub is used at most once.
 */
export async function matchStubsToLines(
  db: Kysely<DB>,
  businessId: string,
  lines: StubCandidateLine[],
): Promise<Map<number, CheckStubRow>> {
  const result = new Map<number, CheckStubRow>();
  const relevant = lines.filter(line => line.is_check || line.check_number);
  if (relevant.length === 0) return result;
  const stubs = (await db.selectFrom('check_stubs').selectAll()
    .where('business_id', '=', businessId)
    .where('status', '=', 'unmatched')
    .execute()).map(toStubRow);
  if (stubs.length === 0) return result;

  const taken = new Set<string>();
  // Numbered matches first, so an amount-only guess never takes a stub a
  // numbered line needs.
  for (const line of relevant) {
    const number = cleanCheckNumber(line.check_number);
    if (!number) continue;
    const stub = stubs.find(s => !taken.has(s.id) && s.check_number === number && cents(s.amount) === cents(line.amount));
    if (stub) { taken.add(stub.id); result.set(line.index, stub); }
  }
  for (const line of relevant) {
    if (result.has(line.index) || cleanCheckNumber(line.check_number)) continue;
    const lineTime = Date.parse(line.date);
    const options = stubs.filter(s => !taken.has(s.id)
      && cents(s.amount) === cents(line.amount)
      && (!s.check_date || Number.isNaN(lineTime)
        || Math.abs(Date.parse(s.check_date) - lineTime) <= AMOUNT_ONLY_WINDOW_DAYS * 86_400_000));
    if (options.length === 1) { taken.add(options[0]!.id); result.set(line.index, options[0]!); }
  }
  return result;
}

export type PostedCheck = {
  kind: 'expense' | 'imported';
  /** expense_transactions id, or the journal entry id for an unwrapped import. */
  id: string;
  journal_entry_id: string;
  date: string;
  payee: string | null;
  path: string;
};

/** A check already in the books that this stub describes (same number and amount). */
async function findPostedCheck(
  db: Kysely<DB> | Transaction<DB>, businessId: string, stub: CheckStubRow,
): Promise<PostedCheck | null> {
  if (!stub.check_number) return null;
  const amount = (cents(stub.amount) / 100).toFixed(2);

  const expense = await db.selectFrom('expense_transactions as e')
    .innerJoin('journal_entries as je', 'je.id', 'e.journal_entry_id')
    .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
    .select(['e.id', 'e.journal_entry_id', 'e.transaction_date', 'e.payee_text', 'v.name as vendor_name'])
    .where('e.business_id', '=', businessId)
    .where('e.status', '=', 'posted')
    .where('e.payment_method', '=', 'check')
    .where('e.total_amount', '=', amount)
    .where(eb => eb.or([
      eb('e.reference', '=', stub.check_number),
      eb('je.reference', '=', stub.check_number),
      eb('e.memo', '~*', `(check|chk|ck)[^0-9]{0,6}0*${stub.check_number}([^0-9]|$)`),
    ]))
    .where(eb => eb.not(eb.exists(eb.selectFrom('check_stubs as used').select('used.id')
      .whereRef('used.matched_journal_entry_id', '=', 'e.journal_entry_id'))))
    .executeTakeFirst();
  if (expense?.journal_entry_id) {
    return {
      kind: 'expense',
      id: expense.id,
      journal_entry_id: expense.journal_entry_id,
      date: String(expense.transaction_date).slice(0, 10),
      payee: expense.vendor_name ?? expense.payee_text,
      path: `/accounting/expenses/${expense.id}`,
    };
  }

  const imported = await db.selectFrom('journal_entries as je')
    .select(['je.id', 'je.entry_date', 'je.payee_name'])
    .where('je.business_id', '=', businessId)
    .where('je.status', '=', 'posted')
    .where('je.source_type', '=', 'bank_import')
    .where('je.transaction_type', '=', 'check')
    .where('je.reference', '=', stub.check_number)
    .where(eb => eb.exists(eb.selectFrom('journal_entry_lines as l').select('l.id')
      .whereRef('l.journal_entry_id', '=', 'je.id')
      .where('l.credit', '=', (cents(stub.amount) / 100).toFixed(4))))
    .where(eb => eb.not(eb.exists(eb.selectFrom('expense_transactions as w').select('w.id')
      .whereRef('w.journal_entry_id', '=', 'je.id'))))
    .where(eb => eb.not(eb.exists(eb.selectFrom('check_stubs as used').select('used.id')
      .whereRef('used.matched_journal_entry_id', '=', 'je.id'))))
    .executeTakeFirst();
  if (!imported) return null;
  return {
    kind: 'imported',
    id: imported.id,
    journal_entry_id: imported.id,
    date: String(imported.entry_date).slice(0, 10),
    payee: imported.payee_name,
    path: `/transactions/${imported.id}`,
  };
}

export type CheckStubListItem = CheckStubRow & { posted_check: PostedCheck | null };

export async function listCheckStubs(db: Kysely<DB>, ctx: ServiceCtx): Promise<CheckStubListItem[]> {
  const businessId = ctx.business_id;
  if (!businessId) return [];
  const rows = await db.selectFrom('check_stubs').selectAll()
    .where('business_id', '=', businessId)
    .orderBy('status')
    .orderBy('check_date', 'desc')
    .orderBy('created_at', 'desc')
    .execute();
  const out: CheckStubListItem[] = [];
  for (const row of rows) {
    const stub = toStubRow(row);
    out.push({ ...stub, posted_check: stub.status === 'unmatched' ? await findPostedCheck(db, businessId, stub) : null });
  }
  return out;
}

/**
 * Fill in a check that is already in the books from its stub: payee (linked to
 * the vendor when the name matches one), memo, check number, and -- when given
 * and the check has a single category line -- the category. Marks the stub used.
 */
export async function applyCheckStub(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { stub_id: string; category_account_id?: string | null },
): Promise<{ journal_entry_id: string; path: string }> {
  const businessId = ctx.business_id;
  if (!businessId) throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  const row = await loadStub(trx, businessId, input.stub_id);
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, 'Check stub not found');
  const stub = toStubRow(row);
  if (stub.status !== 'unmatched') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'This check stub has already been used');
  }
  const posted = await findPostedCheck(trx, businessId, stub);
  if (!posted) {
    throw new BusinessRuleError(ERR.NOT_FOUND, 'No posted check with this number and amount was found');
  }

  const vendor = stub.payee_name
    ? await trx.selectFrom('vendors').select('id')
      .where('business_id', '=', businessId)
      .where(sql<boolean>`lower(name) = lower(${stub.payee_name})`)
      .executeTakeFirst()
    : undefined;
  const category = input.category_account_id ?? stub.suggested_account_id ?? null;

  let journalEntryId: string;
  let path: string;
  if (posted.kind === 'expense') {
    const expense = await trx.selectFrom('expense_transactions').selectAll()
      .where('id', '=', posted.id).executeTakeFirstOrThrow();
    const lines = await trx.selectFrom('expense_transaction_lines').selectAll()
      .where('expense_transaction_id', '=', posted.id)
      .orderBy('sort_order')
      .execute();
    const updated = await updateExpense(trx, ctx, posted.id, {
      transaction_date: String(expense.transaction_date).slice(0, 10),
      ...(vendor ? { vendor_id: vendor.id, payee_text: null } : { payee_text: stub.payee_name ?? expense.payee_text, vendor_id: null }),
      customer_id: null,
      payment_account_id: expense.payment_account_id,
      payment_method: expense.payment_method,
      reference: stub.check_number,
      memo: stub.memo ?? expense.memo,
      lines: lines.map((line, i) => ({
        category_account_id: lines.length === 1 && category ? category : line.category_account_id,
        description: line.description,
        amount: Number(line.amount).toFixed(2),
        sort_order: line.sort_order ?? i,
      })),
    });
    if (!updated.journal_entry_id) throw new BusinessRuleError(ERR.INTERNAL, 'The check did not repost');
    journalEntryId = updated.journal_entry_id;
    path = `/accounting/expenses/${posted.id}`;
  } else {
    const lines = await trx.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', posted.id)
      .orderBy('line_number')
      .execute();
    const entry = await trx.selectFrom('journal_entries').selectAll()
      .where('id', '=', posted.id).executeTakeFirstOrThrow();
    const [bankLine, categoryLine] = lines;
    if (lines.length !== 2 || !bankLine || !categoryLine) {
      throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'This check was split across several lines; update it by hand.');
    }
    await updateImportedTransaction(trx, ctx, {
      journal_entry_id: posted.id,
      entry_date: String(entry.entry_date).slice(0, 10),
      transaction_type: 'check',
      payee_name: stub.payee_name,
      check_number: stub.check_number,
      memo: stub.memo ?? entry.memo,
      bank_account_id: bankLine.account_id,
      category_account_id: category ?? categoryLine.account_id,
      amount: Number(bankLine.credit).toFixed(2),
    });
    journalEntryId = posted.id;
    path = posted.path;
  }

  await markCheckStubMatched(trx, ctx, { stub_id: stub.id, journal_entry_id: journalEntryId, amount: stub.amount });
  return { journal_entry_id: journalEntryId, path };
}

export async function dismissCheckStub(trx: Transaction<DB>, ctx: ServiceCtx, stubId: string): Promise<void> {
  const businessId = ctx.business_id;
  if (!businessId) throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  const before = await loadStub(trx, businessId, stubId);
  if (!before) throw new BusinessRuleError(ERR.NOT_FOUND, 'Check stub not found');
  const after = await trx.updateTable('check_stubs').set({ status: 'dismissed' })
    .where('id', '=', stubId).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.CHECK_STUB_DISMISS, entity_type: 'check_stub', entity_id: stubId, before, after,
  });
}
