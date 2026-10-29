import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT, isZero, subMoney, toMoneyString } from '@accounting/shared';
import type { DB, QbImportEntityType, QbImportStep } from '../../db/types.js';
import { record as auditRecord } from '../audit/auditService.js';
import { scopeBusiness, type ServiceCtx } from '../../lib/ctx.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { computeTrialBalance, voidJournalEntry } from '../core/ledgerService.js';
import { updateAccount } from '../core/chartOfAccountsService.js';
import { customerHasAnyTransaction, deleteCustomer } from '../ar/customerService.js';
import { deleteVendor, vendorHasAnyTransaction } from '../ap/vendorService.js';
import { deleteItem } from '../inventory/inventoryItemService.js';
import { voidInvoice } from '../ar/invoiceService.js';
import { voidBill } from '../ap/billService.js';
import { voidCreditMemo } from '../ar/creditMemoService.js';
import { voidVendorCredit } from '../ap/vendorCreditService.js';

// Import batches: each upload on Setup -> Import from QuickBooks, what it made,
// and undoing it. Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

/** A row the upload cannot take as it is. Any one of them stops the whole upload. */
export type QbProblem = { row: number | null; message: string };

export type QbImportResult = {
  batch_id: string | null;
  problems: QbProblem[];
  /** What the upload did that is worth knowing but stops nothing: rows skipped, numbers changed. */
  notes: string[];
  counts: Record<string, number>;
  /** Step-specific detail for the preview (the opening entry's lines, for one). */
  preview?: unknown;
};

export const emptyResult = (): QbImportResult => ({ batch_id: null, problems: [], notes: [], counts: {} });

export type QbRecord = { entity_type: QbImportEntityType; entity_id: string; previous?: unknown };

class Rollback extends Error {
  constructor(public readonly result: QbImportResult) { super('rollback'); }
}

/** Runs one upload in its own transaction, rolled back for a dry run or when it found any problem. */
export async function runQbImport(
  db: Kysely<DB>, work: (trx: Transaction<DB>) => Promise<QbImportResult>, dryRun: boolean,
): Promise<QbImportResult> {
  try {
    return await db.transaction().execute(async trx => {
      const result = await work(trx);
      if (dryRun || result.problems.length > 0) throw new Rollback(result);
      return result;
    });
  } catch (e: unknown) {
    if (e instanceof Rollback) return { ...e.result, batch_id: null };
    throw e;
  }
}

/** Steps that post to the ledger before the opening entry, and so must come before it. */
const POSTS_BEFORE_OPENING: QbImportStep[] = ['items', 'open_invoices', 'open_bills', 'uncleared', 'history'];

export async function activeBatches(db: Kysely<DB> | Transaction<DB>, business_id: string) {
  return db.selectFrom('qb_import_batches').selectAll()
    .where('business_id', '=', business_id).where('undone_at', 'is', null)
    .orderBy('created_at', 'asc').execute();
}

/**
 * Every active upload of a company is on one cutover date, and nothing is
 * added under the opening entry once it is posted: it is worked out from what
 * is already here, so it would be wrong afterwards.
 */
export async function guardProblems(
  trx: Transaction<DB>, business_id: string, step: QbImportStep, cutover_date: string, posts = true,
): Promise<QbProblem[]> {
  const active = await activeBatches(trx, business_id);
  const problems: QbProblem[] = [];
  const other = active.find(b => String(b.cutover_date).slice(0, 10) !== cutover_date);
  if (other) {
    problems.push({
      row: null,
      message: `This company's import uses the cutover date ${String(other.cutover_date).slice(0, 10)}. Undo its uploads to change it`,
    });
  }
  if (posts && POSTS_BEFORE_OPENING.includes(step) && active.some(b => b.step === 'trial_balance')) {
    problems.push({
      row: null,
      message: 'The opening balances are already posted, and they are worked out from what is here. Undo them, add this, then post them again',
    });
  }
  if (step === 'trial_balance' && active.some(b => b.step === 'trial_balance')) {
    problems.push({ row: null, message: 'The opening balances are already posted. Undo them first to post them again' });
  }
  return problems;
}

/** Rows dated where nothing can post: no fiscal period, a closed one, or after the cutover date. */
export async function dateProblems(
  trx: Transaction<DB>, business_id: string, cutover_date: string, rows: { row: number; date: string }[],
): Promise<QbProblem[]> {
  const periods = await trx.selectFrom('fiscal_periods').select(['starts_on', 'ends_on', 'status'])
    .where('business_id', '=', business_id).execute();
  const spans = periods.map(p => ({ from: String(p.starts_on).slice(0, 10), to: String(p.ends_on).slice(0, 10), closed: p.status === 'closed' }));
  const problems: QbProblem[] = [];
  const missing = new Set<string>();
  const closed = new Set<string>();
  for (const r of rows) {
    if (r.date > cutover_date) {
      problems.push({ row: r.row, message: `Dated ${r.date}, after the cutover date ${cutover_date}` });
      continue;
    }
    const span = spans.find(s => s.from <= r.date && r.date <= s.to);
    if (!span) missing.add(r.date.slice(0, 4));
    else if (span.closed) closed.add(r.date.slice(0, 7));
  }
  for (const year of [...missing].sort()) {
    problems.push({ row: null, message: `Some rows are dated in ${year}, which has no fiscal periods here. Set up ${year}'s periods first` });
  }
  for (const month of [...closed].sort()) {
    problems.push({ row: null, message: `Some rows are dated in ${month}, a closed period. Reopen it first` });
  }
  return problems;
}

export async function createBatch(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { step: QbImportStep; cutover_date: string; file_name: string | null; summary: unknown; records: QbRecord[] },
): Promise<string> {
  const business_id = scopeBusiness(ctx);
  const batch = await trx.insertInto('qb_import_batches').values({
    business_id, step: input.step, cutover_date: input.cutover_date, file_name: input.file_name,
    summary: JSON.stringify(input.summary), created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();
  for (let i = 0; i < input.records.length; i += 1000) {
    await trx.insertInto('qb_import_records').values(input.records.slice(i, i + 1000).map((r, k) => ({
      batch_id: batch.id, entity_type: r.entity_type, entity_id: r.entity_id,
      previous: r.previous === undefined ? null : JSON.stringify(r.previous), sort_order: i + k,
    }))).execute();
  }
  await auditRecord(trx, ctx, {
    action: AUDIT.QB_IMPORT_POST, entity_type: 'qb_import_batch', entity_id: batch.id,
    before: null, after: { step: input.step, cutover_date: input.cutover_date, file_name: input.file_name, records: input.records.length, summary: input.summary },
  });
  return batch.id;
}

export async function listBatches(db: Kysely<DB>, business_id: string) {
  const batches = await db.selectFrom('qb_import_batches as b')
    .leftJoin('users as u', 'u.id', 'b.created_by_user_id')
    .select(['b.id', 'b.step', 'b.cutover_date', 'b.file_name', 'b.summary', 'b.created_at', 'b.undone_at', 'u.full_name as created_by'])
    .select(eb => eb.selectFrom('qb_import_records as r').select(({ fn }) => fn.countAll<string>().as('n'))
      .whereRef('r.batch_id', '=', 'b.id').as('record_count'))
    .where('b.business_id', '=', business_id)
    .orderBy('b.created_at', 'desc')
    .execute();
  const active = batches.filter(b => b.undone_at === null);
  return {
    cutover_date: active.length > 0 ? String(active[0]!.cutover_date).slice(0, 10) : null,
    batches: batches.map(b => ({
      ...b, cutover_date: String(b.cutover_date).slice(0, 10), record_count: Number(b.record_count ?? 0),
    })),
  };
}

const UNDO_REASON = 'QuickBooks import undone';

/** Undoes one upload: voids what it posted and removes what it added, newest first. */
export async function undoBatch(trx: Transaction<DB>, ctx: ServiceCtx, batch_id: string) {
  const business_id = scopeBusiness(ctx);
  const batch = await trx.selectFrom('qb_import_batches').selectAll()
    .where('id', '=', batch_id).where('business_id', '=', business_id).forUpdate().executeTakeFirst();
  if (!batch) throw new NotFoundError('qb_import_batch', batch_id);
  if (batch.undone_at) throw new PreconditionError('This upload is already undone');

  const records = await trx.selectFrom('qb_import_records').selectAll()
    .where('batch_id', '=', batch_id).orderBy('sort_order', 'desc').execute();

  // Reconciliations go first: they hold the entries they ticked.
  for (const r of records.filter(x => x.entity_type === 'reconciliation')) await undoStartingReconciliation(trx, business_id, r.entity_id);
  for (const r of records) {
    switch (r.entity_type) {
      case 'reconciliation':
        break;
      case 'journal_entry': {
        const je = await trx.selectFrom('journal_entries').select(['status', 'reconciliation_status'])
          .where('id', '=', r.entity_id).executeTakeFirst();
        if (!je || je.status !== 'posted') break;
        if (je.reconciliation_status === 'reconciled') {
          throw new PreconditionError('An entry from this upload has been reconciled since. Undo that reconciliation first');
        }
        await voidJournalEntry(trx, ctx, { journal_entry_id: r.entity_id, void_reason: UNDO_REASON });
        break;
      }
      case 'invoice': {
        await refuseIfApplied(trx, 'invoice', r.entity_id);
        const inv = await trx.selectFrom('invoices').select('status').where('id', '=', r.entity_id).executeTakeFirst();
        if (inv && (inv.status === 'posted' || inv.status === 'paid')) await voidInvoice(trx, ctx, { invoice_id: r.entity_id, void_reason: UNDO_REASON });
        break;
      }
      case 'bill': {
        await refuseIfApplied(trx, 'bill', r.entity_id);
        const bill = await trx.selectFrom('bills').select('status').where('id', '=', r.entity_id).executeTakeFirst();
        if (bill && (bill.status === 'posted' || bill.status === 'paid')) await voidBill(trx, ctx, { bill_id: r.entity_id, void_reason: UNDO_REASON });
        break;
      }
      case 'credit_memo': {
        const cm = await trx.selectFrom('credit_memos').select(['status', 'amount', 'remaining_amount']).where('id', '=', r.entity_id).executeTakeFirst();
        if (!cm || (cm.status !== 'posted' && cm.status !== 'applied')) break;
        if (!isZero(subMoney(cm.amount, cm.remaining_amount))) throw new PreconditionError('A credit from this upload has been used on an invoice since. Remove that first');
        await voidCreditMemo(trx, ctx, { credit_memo_id: r.entity_id, void_reason: UNDO_REASON });
        break;
      }
      case 'vendor_credit': {
        const vc = await trx.selectFrom('vendor_credits').select(['status', 'amount', 'remaining_amount']).where('id', '=', r.entity_id).executeTakeFirst();
        if (!vc || (vc.status !== 'posted' && vc.status !== 'applied')) break;
        if (!isZero(subMoney(vc.amount, vc.remaining_amount))) throw new PreconditionError('A vendor credit from this upload has been used on a bill since. Remove that first');
        await voidVendorCredit(trx, ctx, { vendor_credit_id: r.entity_id, void_reason: UNDO_REASON });
        break;
      }
      case 'stock_movement': {
        const sm = await trx.selectFrom('stock_movements').select(['id', 'journal_entry_id']).where('id', '=', r.entity_id).executeTakeFirst();
        if (!sm) break;
        if (sm.journal_entry_id) {
          const je = await trx.selectFrom('journal_entries').select('status').where('id', '=', sm.journal_entry_id).executeTakeFirst();
          if (je?.status === 'posted') await voidJournalEntry(trx, ctx, { journal_entry_id: sm.journal_entry_id, void_reason: UNDO_REASON });
        }
        await trx.deleteFrom('stock_movements').where('id', '=', sm.id).execute();
        break;
      }
      case 'inventory_item': {
        const used = await trx.selectFrom('stock_movements').select('id').where('inventory_item_id', '=', r.entity_id).executeTakeFirst()
          ?? await trx.selectFrom('invoice_lines').select('id').where('inventory_item_id', '=', r.entity_id).executeTakeFirst();
        if (used) throw new PreconditionError('A product or service from this upload has been used since. It can be made inactive instead');
        const item = await trx.selectFrom('inventory_items').select('deleted_at').where('id', '=', r.entity_id).executeTakeFirst();
        if (item && !item.deleted_at) await deleteItem(trx, ctx, { business_id, item_id: r.entity_id });
        break;
      }
      case 'customer': {
        const c = await trx.selectFrom('customers').select(['name', 'deleted_at']).where('id', '=', r.entity_id).executeTakeFirst();
        if (!c || c.deleted_at) break;
        if (await customerHasAnyTransaction(trx, r.entity_id)) {
          throw new PreconditionError(`${c.name} has transactions now. Undo the open invoices first, or make the customer inactive`);
        }
        await deleteCustomer(trx, ctx, { customer_id: r.entity_id });
        break;
      }
      case 'vendor': {
        const v = await trx.selectFrom('vendors').select(['name', 'deleted_at']).where('id', '=', r.entity_id).executeTakeFirst();
        if (!v || v.deleted_at) break;
        if (await vendorHasAnyTransaction(trx, r.entity_id)) {
          throw new PreconditionError(`${v.name} has transactions now. Undo the unpaid bills first, or make the vendor inactive`);
        }
        await deleteVendor(trx, ctx, { vendor_id: r.entity_id });
        break;
      }
      case 'account':
        await deleteImportedAccount(trx, ctx, r.entity_id);
        break;
      case 'account_renamed': {
        const prev = (typeof r.previous === 'string' ? JSON.parse(r.previous) : r.previous) as { name: string; code: string } | null;
        if (prev) await updateAccount(trx, ctx, { account_id: r.entity_id, patch: { name: prev.name, code: prev.code } });
        break;
      }
    }
  }

  const undone = await trx.updateTable('qb_import_batches')
    .set({ undone_at: sql`now()`, undone_by_user_id: ctx.user_id })
    .where('id', '=', batch_id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.QB_IMPORT_UNDO, entity_type: 'qb_import_batch', entity_id: batch_id,
    before: { step: batch.step, records: records.length }, after: { undone_at: undone.undone_at },
  });
  return undone;
}

async function refuseIfApplied(trx: Transaction<DB>, kind: 'invoice' | 'bill', id: string) {
  const applied = kind === 'invoice'
    ? await trx.selectFrom('payment_applications').select('id').where('invoice_id', '=', id).executeTakeFirst()
    : await trx.selectFrom('bill_payment_applications').select('id').where('bill_id', '=', id).executeTakeFirst();
  if (applied) {
    throw new PreconditionError(kind === 'invoice'
      ? 'An invoice from this upload has had a payment or credit applied since. Remove that first'
      : 'A bill from this upload has had a payment or credit applied since. Remove that first');
  }
}

/** An account the import added, taken out again: only while nothing uses it. */
async function deleteImportedAccount(trx: Transaction<DB>, ctx: ServiceCtx, account_id: string) {
  const account = await trx.selectFrom('chart_of_accounts').selectAll().where('id', '=', account_id).executeTakeFirst();
  if (!account) return;
  const line = await trx.selectFrom('journal_entry_lines as l').innerJoin('journal_entries as j', 'j.id', 'l.journal_entry_id')
    .select('l.id').where('l.account_id', '=', account_id).where('j.status', '=', 'posted').executeTakeFirst();
  const child = await trx.selectFrom('chart_of_accounts').select('id').where('parent_id', '=', account_id).executeTakeFirst();
  const item = await trx.selectFrom('inventory_items').select('id').where('deleted_at', 'is', null)
    .where(eb => eb.or([
      eb('income_account_id', '=', account_id), eb('expense_account_id', '=', account_id), eb('inventory_asset_account_id', '=', account_id),
    ])).executeTakeFirst();
  if (line || child || item) {
    throw new PreconditionError(`${account.code} ${account.name} is in use now. Undo the later uploads first, or make the account inactive`);
  }
  // Lines of voided entries still point at it; an account with any is made inactive instead.
  const anyLine = await trx.selectFrom('journal_entry_lines').select('id').where('account_id', '=', account_id).executeTakeFirst();
  if (anyLine) {
    await updateAccount(trx, ctx, { account_id, patch: { is_active: false } });
    return;
  }
  await trx.deleteFrom('chart_of_accounts').where('id', '=', account_id).execute();
  await auditRecord(trx, ctx, { action: AUDIT.COA_DELETE, entity_type: 'chart_of_account', entity_id: account_id, before: account, after: null });
}

/** Puts back what a starting reconciliation ticked, and removes it. */
async function undoStartingReconciliation(trx: Transaction<DB>, business_id: string, reconciliation_id: string) {
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', reconciliation_id).where('business_id', '=', business_id).executeTakeFirst();
  if (!recon) return;
  const later = await trx.selectFrom('reconciliations').select('id')
    .where('account_id', '=', recon.account_id).where('id', '!=', recon.id)
    .where('status', 'in', ['in_progress', 'completed'])
    .where('statement_ending_date', '>=', recon.statement_ending_date)
    .executeTakeFirst();
  if (later) throw new PreconditionError('An account has been reconciled since the opening balances were posted. Undo that reconciliation first');
  for (const table of ['journal_entries', 'bank_deposits', 'checks', 'expense_transactions'] as const) {
    await trx.updateTable(table)
      .set({ reconciliation_status: 'unreconciled', reconciliation_id: null })
      .where('reconciliation_id', '=', recon.id).execute();
  }
  await trx.deleteFrom('reconciliation_items').where('reconciliation_id', '=', recon.id).execute();
  await trx.deleteFrom('reconciliations').where('id', '=', recon.id).execute();
}

/** QuickBooks' trial balance at the cutover date beside this company's, account by account. */
export async function importCheck(db: Kysely<DB>, business_id: string) {
  const active = await activeBatches(db, business_id);
  const tb = active.find(b => b.step === 'trial_balance');
  if (!tb) return { cutover_date: active[0] ? String(active[0].cutover_date).slice(0, 10) : null, posted: false as const, rows: [], differences: 0 };
  const cutover = String(tb.cutover_date).slice(0, 10);
  const summary = (typeof tb.summary === 'string' ? JSON.parse(tb.summary) : tb.summary) as { quickbooks: { account_id: string; net: string }[] };
  const ours = await computeTrialBalance(db, { business_id, as_of: cutover });
  const accounts = await db.selectFrom('chart_of_accounts').select(['id', 'code', 'name', 'account_type'])
    .where('business_id', '=', business_id).execute();
  const qb = new Map(summary.quickbooks.map(l => [l.account_id, l.net]));
  const here = new Map(ours.rows.map(r => [r.account_id, r.net]));
  const ids = new Set([...qb.keys(), ...here.keys()]);
  const rows = accounts.filter(a => ids.has(a.id)).map(a => {
    const quickbooks = toMoneyString(qb.get(a.id) ?? '0');
    const ourNet = toMoneyString(here.get(a.id) ?? '0');
    return { account_id: a.id, code: a.code, name: a.name, account_type: a.account_type, quickbooks, here: ourNet, difference: toMoneyString(subMoney(ourNet, quickbooks)) };
  }).filter(r => !(isZero(r.quickbooks) && isZero(r.here)))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { cutover_date: cutover, posted: true as const, rows, differences: rows.filter(r => !isZero(r.difference)).length };
}
