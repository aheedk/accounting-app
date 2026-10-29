import { sql, type Kysely, type Transaction } from 'kysely';
import type { schemas } from '@accounting/shared';
import { addMoney, equalMoney, isZero, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { scopeBusiness, type ServiceCtx } from '../../lib/ctx.js';
import { getOrCreateOpeningBalanceEquity } from '../core/chartOfAccountsService.js';
import {
  computeTrialBalance, postJournalEntry, postJournalEntryBatch, type LineInput, type PostJournalEntryInput,
} from '../core/ledgerService.js';
import {
  finishReconciliation, getWorksheet, reconcilableCategory, saveProgress, startReconciliation,
} from '../banking/bankReconciliationWorksheetService.js';
import {
  activeBatches, createBatch, dateProblems, emptyResult, guardProblems, type QbImportResult, type QbProblem, type QbRecord,
} from './qbBatches.js';
import { loadAccounts } from './qbLists.js';
import { makeAccountMatcher, norm, type MatchableAccount } from './qbMatch.js';

// QuickBooks' transaction types, as the app's own (journal_entries keeps a
// fixed list). Anything else is a journal entry, its QuickBooks name kept in the memo.
const QB_TYPES: Record<string, string> = {
  'deposit': 'deposit', 'sales receipt': 'deposit',
  'check': 'check', 'payroll check': 'check', 'refund': 'check', 'refund receipt': 'check',
  'expense': 'expense', 'cash expense': 'expense', 'credit card expense': 'expense',
  'journal entry': 'journal_entry',
  'invoice': 'invoice', 'bill': 'bill',
  'payment': 'payment', 'receive payment': 'payment',
  'bill payment': 'bill_payment', 'bill payment (check)': 'bill_payment', 'bill payment (credit card)': 'bill_payment',
  'vendor credit': 'vendor_credit', 'credit memo': 'credit_memo',
  'credit card payment': 'credit_card_payment', 'credit card credit': 'credit_card_credit',
  'transfer': 'transfer',
};
export const qbTransactionType = (type: string | null | undefined): string => QB_TYPES[norm(type ?? '')] ?? 'journal_entry';

// Steps 2, 4 and 5 of moving a client from QuickBooks: the bank items not yet
// cleared, the history, and the opening entry, which is posted last.
// Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

const debitOf = (amount: string) => (Number(amount) > 0 ? toMoneyString(amount) : '0.0000');
const creditOf = (amount: string) => (Number(amount) < 0 ? toMoneyString(amount.replace('-', '')) : '0.0000');

/** An account a line needs that can take no postings here. */
function postableProblem(account: MatchableAccount, row: number | null): QbProblem | null {
  if (!account.is_active) return { row, message: `${account.code} ${account.name} is inactive here. Reactivate it first` };
  if (account.is_locked) return { row, message: `${account.code} ${account.name} is locked here. Unlock it first` };
  return null;
}

/**
 * Step 4: each bank or card item QuickBooks had not cleared at the cutover
 * date, as an entry of its own against Opening Balance Equity, so it can be
 * ticked when it clears. An upload with no rows records that the account had
 * nothing outstanding.
 */
export async function importUncleared(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbUnclearedImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const result = emptyResult();
  result.problems.push(...await guardProblems(trx, business_id, 'uncleared', input.cutover_date));
  const m = makeAccountMatcher(await loadAccounts(trx, business_id))(input.account);
  if ('error' in m) { result.problems.push({ row: null, message: m.error }); return result; }
  const account = m.account;
  if (account.account_type !== 'asset' && account.account_type !== 'liability') {
    result.problems.push({ row: null, message: `${account.code} ${account.name} is not a bank or credit card account` });
  }
  const postable = postableProblem(account, null);
  if (postable) result.problems.push(postable);
  const already = (await activeBatches(trx, business_id))
    .filter(b => b.step === 'uncleared')
    .some(b => (b.summary as { account_id?: string } | null)?.account_id === account.id);
  if (already) result.problems.push({ row: null, message: `${account.name}'s uncleared items are already here. Undo that upload to bring them again` });
  const rows = input.rows.map((row, i) => ({ row, i })).filter(({ row }) => !isZero(row.amount));
  result.problems.push(...await dateProblems(trx, business_id, input.cutover_date, rows.map(({ row, i }) => ({ row: i, date: row.date }))));
  if (result.problems.length > 0) return result;

  const obe = await getOrCreateOpeningBalanceEquity(trx, ctx, business_id);
  const entries: PostJournalEntryInput[] = rows.map(({ row }) => {
    const amount = toMoneyString(row.amount);
    const type = row.type?.trim() || (Number(amount) > 0 ? 'Deposit' : 'Payment');
    return {
      business_id, entry_date: row.date, source_type: 'manual', transaction_type: qbTransactionType(type),
      payee_name: row.name?.trim() || null, reference: row.number?.trim() || null,
      memo: row.memo?.trim() || `${type} not yet cleared at cutover (from QuickBooks)`,
      lines: [
        { account_id: account.id, debit: debitOf(amount), credit: creditOf(amount), memo: null, name: row.name?.trim() || null },
        { account_id: obe.id, debit: creditOf(amount), credit: debitOf(amount), memo: null },
      ],
    };
  });
  const posted = await postJournalEntryBatch(trx, ctx, entries);
  const records: QbRecord[] = posted.map(p => ({ entity_type: 'journal_entry', entity_id: p.id }));
  const total = toMoneyString(rows.reduce((s, { row }) => addMoney(s, row.amount), addMoney('0', '0')));
  result.counts = { items: records.length };
  result.preview = { account_id: account.id, account: `${account.code} ${account.name}`, total };
  result.batch_id = await createBatch(trx, ctx, {
    step: 'uncleared', cutover_date: input.cutover_date, file_name: input.file_name ?? null,
    summary: { account_id: account.id, account: `${account.code} ${account.name}`, items: records.length, total }, records,
  });
  return result;
}

/**
 * Step 5: every past transaction from QuickBooks' Journal report, as a journal
 * entry with QuickBooks' date, type, number and name. Brought in before the
 * opening entry, which then posts only what the history leaves different.
 */
export async function importHistory(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbHistoryImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const result = emptyResult();
  result.problems.push(...await guardProblems(trx, business_id, 'history', input.cutover_date));

  const match = makeAccountMatcher(await loadAccounts(trx, business_id));
  const byLabel = new Map<string, MatchableAccount | null>();
  for (const t of input.transactions) {
    for (const l of t.lines) {
      if (byLabel.has(l.account)) continue;
      const m = match(l.account);
      if ('error' in m) { byLabel.set(l.account, null); result.problems.push({ row: null, message: m.error }); continue; }
      byLabel.set(l.account, m.account);
      const postable = postableProblem(m.account, null);
      if (postable) result.problems.push(postable);
    }
  }

  const kept: { t: schemas.QbHistoryImport['transactions'][number]; i: number; lines: LineInput[] }[] = [];
  let empty = 0;
  for (const [i, t] of input.transactions.entries()) {
    const lines = t.lines.filter(l => !isZero(l.debit) || !isZero(l.credit));
    if (lines.length === 0) { empty++; continue; }
    const debit = lines.reduce((s, l) => addMoney(s, l.debit), addMoney('0', '0'));
    const credit = lines.reduce((s, l) => addMoney(s, l.credit), addMoney('0', '0'));
    const what = `${t.type ?? 'Transaction'}${t.number ? ` ${t.number}` : ''} of ${t.date}`;
    if (!equalMoney(debit, credit)) {
      result.problems.push({ row: i, message: `${what} doesn't balance: debits ${toMoneyString(debit)}, credits ${toMoneyString(credit)}` });
      continue;
    }
    if (lines.some(l => !byLabel.get(l.account))) continue;
    kept.push({
      t, i,
      lines: lines.map(l => {
        // A line with both sides (rare in an export) posts its net.
        const net = subMoney(l.debit, l.credit);
        return {
          account_id: byLabel.get(l.account)!.id,
          debit: net.gt(0) ? toMoneyString(net) : '0.0000',
          credit: net.lt(0) ? toMoneyString(net.negated()) : '0.0000',
          memo: l.memo?.trim() || null, name: l.name?.trim() || t.name?.trim() || null,
        };
      }),
    });
  }
  result.problems.push(...await dateProblems(trx, business_id, input.cutover_date, kept.map(k => ({ row: k.i, date: k.t.date }))));
  if (result.problems.length > 0) return result;

  const records: QbRecord[] = [];
  for (let start = 0; start < kept.length; start += 500) {
    const chunk = kept.slice(start, start + 500).map(({ t, lines }): PostJournalEntryInput => ({
      business_id, entry_date: t.date, source_type: 'manual', transaction_type: qbTransactionType(t.type),
      payee_name: t.name?.trim() || null, reference: t.number?.trim() || null,
      memo: [t.type?.trim(), t.memo?.trim()].filter(Boolean).join(': ') || null, lines,
    }));
    const posted = await postJournalEntryBatch(trx, ctx, chunk);
    records.push(...posted.map(p => ({ entity_type: 'journal_entry' as const, entity_id: p.id })));
  }
  if (empty > 0) result.notes.push(`${empty} had no amounts and were left out`);
  const dates = kept.map(k => k.t.date).sort();
  result.counts = { transactions: records.length };
  result.preview = { first_date: dates[0] ?? null, last_date: dates.at(-1) ?? null };
  if (records.length > 0) {
    result.batch_id = await createBatch(trx, ctx, {
      step: 'history', cutover_date: input.cutover_date, file_name: input.file_name ?? null,
      summary: { transactions: records.length, first_date: dates[0], last_date: dates.at(-1) }, records,
    });
  }
  return result;
}

export type OpeningLine = {
  account_id: string; code: string; name: string; account_type: string;
  quickbooks: string; here: string; entry: string;
};

/**
 * Step 2, posted last: the entry that brings each account from what is here
 * at the cutover date to QuickBooks' trial balance. What the other steps
 * brought in (open invoices on Accounts Receivable, uncleared items on a bank,
 * history on everything) is already here, so it is not counted twice. Then
 * each bank and card account is reconciled to the cutover date, leaving only
 * the uncleared items to tick.
 */
export async function importTrialBalance(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbTrialBalanceImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const cutover = input.cutover_date;
  const result = emptyResult();
  result.problems.push(...await guardProblems(trx, business_id, 'trial_balance', cutover));
  result.problems.push(...await dateProblems(trx, business_id, cutover, [{ row: 0, date: cutover }]));

  const accounts = await loadAccounts(trx, business_id);
  const match = makeAccountMatcher(accounts);
  const target = new Map<string, string>();
  let debits = '0';
  let credits = '0';
  for (const [i, line] of input.lines.entries()) {
    debits = toMoneyString(addMoney(debits, line.debit));
    credits = toMoneyString(addMoney(credits, line.credit));
    const m = match(line.account);
    if ('error' in m) { result.problems.push({ row: i, message: m.error }); continue; }
    target.set(m.account.id, toMoneyString(addMoney(target.get(m.account.id) ?? '0', subMoney(line.debit, line.credit))));
  }
  if (!equalMoney(debits, credits)) {
    result.problems.push({ row: null, message: `QuickBooks' trial balance doesn't balance as read: debits ${debits}, credits ${credits}. Check the file is the whole report` });
  }
  if (result.problems.length > 0) return result;

  const ours = await computeTrialBalance(trx as unknown as Kysely<DB>, { business_id, as_of: cutover });
  const byId = new Map(accounts.map(a => [a.id, a]));
  const here = new Map(ours.rows.filter(r => byId.has(r.account_id)).map(r => [r.account_id, r.net]));
  const opening: OpeningLine[] = [];
  const lines: LineInput[] = [];
  for (const id of new Set([...target.keys(), ...here.keys()])) {
    const a = byId.get(id)!;
    const quickbooks = toMoneyString(target.get(id) ?? '0');
    const ourNet = toMoneyString(here.get(id) ?? '0');
    const entry = toMoneyString(subMoney(quickbooks, ourNet));
    if (isZero(quickbooks) && isZero(ourNet)) continue;
    opening.push({ account_id: id, code: a.code, name: a.name, account_type: a.account_type, quickbooks, here: ourNet, entry });
    if (isZero(entry)) continue;
    const postable = postableProblem(a, null);
    if (postable) result.problems.push(postable);
    lines.push({ account_id: id, debit: debitOf(entry), credit: creditOf(entry), memo: null });
  }
  opening.sort((x, y) => x.code.localeCompare(y.code));
  result.preview = { lines: opening };
  if (result.problems.length > 0) return result;

  result.notes.push(...await subledgerNotes(trx, business_id, accounts, target));

  const records: QbRecord[] = [];
  if (lines.length > 0) {
    const entry = await postJournalEntry(trx, ctx, {
      business_id, entry_date: cutover, source_type: 'manual', transaction_type: 'journal_entry',
      reference: 'QB-OPENING', memo: `Opening balances from QuickBooks: its trial balance as of ${cutover}`, lines,
    });
    records.push({ entity_type: 'journal_entry', entity_id: entry.id });
  } else {
    result.notes.push('Every account already matches QuickBooks, so no opening entry was needed');
  }

  const reconciled = await startingReconciliations(trx, ctx, business_id, cutover, accounts);
  records.push(...reconciled.records);
  result.notes.push(...reconciled.notes);

  result.counts = { entry_lines: lines.length, reconciled_accounts: reconciled.records.length };
  result.batch_id = await createBatch(trx, ctx, {
    step: 'trial_balance', cutover_date: cutover, file_name: input.file_name ?? null,
    summary: {
      quickbooks: [...target.entries()].map(([account_id, net]) => ({ account_id, net })),
      entry_lines: lines.length, reconciled_accounts: reconciled.records.length,
    },
    records,
  });
  return result;
}

/** A word when Accounts Receivable or Payable won't match the open invoices or bills brought in. */
async function subledgerNotes(
  trx: Transaction<DB>, business_id: string, accounts: MatchableAccount[], target: Map<string, string>,
): Promise<string[]> {
  const notes: string[] = [];
  const active = await activeBatches(trx, business_id);
  const sumOf = (step: string) => active.filter(b => b.step === step)
    .reduce((s, b) => toMoneyString(addMoney(s, (b.summary as { net?: string } | null)?.net ?? '0')), '0');
  const sides = [
    { key: 'accounts_receivable', step: 'open_invoices', docs: 'open invoices', sign: 1 },
    { key: 'accounts_payable', step: 'open_bills', docs: 'unpaid bills', sign: -1 },
  ];
  for (const side of sides) {
    const account = accounts.find(a => a.system_key === side.key);
    if (!account) continue;
    const qb = toMoneyString(target.get(account.id) ?? '0');
    const balance = side.sign === 1 ? qb : toMoneyString(subMoney('0', qb));
    const docs = sumOf(side.step);
    if (!equalMoney(balance, docs)) {
      notes.push(`${account.name}: QuickBooks has ${balance}, and the ${side.docs} brought in come to ${docs}. The opening entry makes up the difference, so the aging report won't add up to the account until it is sorted out`);
    }
  }
  return notes;
}

/**
 * Each bank and credit card account, reconciled to the cutover date: every
 * entry up to then ticked except the uncleared items brought in, so the first
 * reconciliation here starts where QuickBooks' last one ended.
 */
async function startingReconciliations(
  trx: Transaction<DB>, ctx: ServiceCtx, business_id: string, cutover: string, accounts: MatchableAccount[],
): Promise<{ records: QbRecord[]; notes: string[] }> {
  const records: QbRecord[] = [];
  const notes: string[] = [];
  const uncleared = new Map<string, Set<string>>();
  for (const b of (await activeBatches(trx, business_id)).filter(x => x.step === 'uncleared')) {
    const account_id = (b.summary as { account_id?: string } | null)?.account_id;
    if (!account_id) continue;
    const ids = await trx.selectFrom('qb_import_records').select('entity_id').where('batch_id', '=', b.id).execute();
    uncleared.set(account_id, new Set(ids.map(r => r.entity_id)));
  }
  const bankRows = new Set((await trx.selectFrom('bank_accounts').select('cash_account_id')
    .where('business_id', '=', business_id).where('deleted_at', 'is', null).execute()).map(r => r.cash_account_id));

  for (const account of accounts) {
    if (account.account_type !== 'asset' && account.account_type !== 'liability') continue;
    const category = reconcilableCategory(account, bankRows.has(account.id));
    if (!uncleared.has(account.id) && category !== 'Bank' && category !== 'Credit Card') continue;
    const anyEntry = await trx.selectFrom('journal_entry_lines as l').innerJoin('journal_entries as j', 'j.id', 'l.journal_entry_id')
      .select('j.id').where('l.account_id', '=', account.id).where('j.status', '=', 'posted')
      .where('j.entry_date', '<=', cutover).where('j.reconciliation_status', '!=', 'reconciled').executeTakeFirst();
    if (!anyEntry) continue;
    const open = await trx.selectFrom('reconciliations').select(['status', 'statement_ending_date'])
      .where('account_id', '=', account.id).where('status', 'in', ['in_progress', 'completed']).execute();
    if (open.some(r => r.status === 'in_progress')) {
      notes.push(`${account.name} has a reconciliation in progress, so it was not reconciled to the cutover date`);
      continue;
    }
    if (open.some(r => String(r.statement_ending_date).slice(0, 10) >= cutover)) continue;

    const leaveOpen = uncleared.get(account.id) ?? new Set<string>();
    const recon = await startReconciliation(trx, ctx, { account_id: account.id, statement_ending_balance: '0', statement_ending_date: cutover });
    const { items } = await getWorksheet(trx as unknown as Kysely<DB>, ctx, recon.id);
    await saveProgress(trx, ctx, recon.id, items.map(it => ({
      transaction_type: it.transaction_type, transaction_id: it.transaction_id,
      is_cleared: !(it.transaction_type === 'journal_entry' && leaveOpen.has(it.transaction_id)),
    })));
    const { summary } = await getWorksheet(trx as unknown as Kysely<DB>, ctx, recon.id);
    await trx.updateTable('reconciliations').set({ statement_ending_balance: summary.cleared_balance, updated_at: sql`now()` })
      .where('id', '=', recon.id).execute();
    await finishReconciliation(trx, ctx, recon.id);
    records.push({ entity_type: 'reconciliation', entity_id: recon.id });
    notes.push(uncleared.has(account.id)
      ? `${account.name} is reconciled to ${cutover} at ${summary.cleared_balance}, with ${leaveOpen.size} uncleared item${leaveOpen.size === 1 ? '' : 's'} left to tick`
      : `${account.name} is reconciled to ${cutover} at ${summary.cleared_balance}. No uncleared items were brought in for it, so all of it was taken as cleared`);
  }
  return { records, notes };
}
