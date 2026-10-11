import { type Kysely, type Transaction, sql } from 'kysely';
import { AUDIT, addMoney, subMoney, toMoneyString, isZero, hasMinRole } from '@accounting/shared';
import type { DB, ReconciliationItemType } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import * as ledger from '../core/ledgerService.js';
import * as expenseSvc from '../ap/expenseTransactionService.js';
import * as depositSvc from './bankDepositService.js';
import { getOrCreateOpeningBalanceEquity } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type StartReconciliationInput = {
  bank_account_id: string;
  statement_ending_balance: string;
  statement_ending_date: string;
  service_charge_amount?: string | null;
  service_charge_date?: string | null;
  service_charge_account_id?: string | null;
  interest_earned_amount?: string | null;
  interest_earned_date?: string | null;
  interest_earned_account_id?: string | null;
};

export type WorksheetItem = {
  transaction_type: ReconciliationItemType;
  transaction_id: string;
  transaction_date: string;
  type_label: string;
  ref_no: string | null;
  name: string | null;
  description: string | null;
  /** Signed: positive is a deposit (money in), negative is a payment (money out). */
  amount: string;
  is_cleared: boolean;
  transaction_path: string;
};

async function resolveBankAccount(db: Kysely<DB> | Transaction<DB>, business_id: string, id: string) {
  const row = await db.selectFrom('bank_accounts').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!row || row.deleted_at) throw new NotFoundError('bank_account', id);
  return row;
}

/** The prior completed reconciliation's statement ending balance, or 0 for the first one. */
async function computeBeginningBalance(db: Kysely<DB> | Transaction<DB>, bank_account_id: string): Promise<string> {
  const prior = await db.selectFrom('reconciliations').select('statement_ending_balance')
    .where('bank_account_id', '=', bank_account_id)
    .where('status', '=', 'completed')
    .orderBy('statement_ending_date', 'desc')
    .executeTakeFirst();
  return prior ? toMoneyString(prior.statement_ending_balance) : '0.00';
}

/** What the Setup page needs before it can offer "Start reconciling": the
 * carried-forward beginning balance, and whether one is already in progress
 * (so the page offers "Resume" instead of letting a second one collide with it). */
export async function getStatus(db: Kysely<DB>, ctx: ServiceCtx, bank_account_id: string) {
  await resolveBankAccount(db, ctx.business_id!, bank_account_id);
  const inProgress = await db.selectFrom('reconciliations').select('id')
    .where('bank_account_id', '=', bank_account_id).where('status', '=', 'in_progress')
    .executeTakeFirst();
  return {
    beginning_balance: await computeBeginningBalance(db, bank_account_id),
    in_progress_id: inProgress?.id ?? null,
  };
}

export async function startReconciliation(
  trx: Transaction<DB>, ctx: ServiceCtx, input: StartReconciliationInput,
) {
  const bizId = ctx.business_id!;
  const bankAccount = await resolveBankAccount(trx, bizId, input.bank_account_id);

  const inProgress = await trx.selectFrom('reconciliations').select('id')
    .where('bank_account_id', '=', input.bank_account_id).where('status', '=', 'in_progress')
    .executeTakeFirst();
  if (inProgress) {
    throw new PreconditionError('A reconciliation is already in progress for this account. Finish or cancel it first.', { reconciliation_id: inProgress.id });
  }

  const beginningBalance = await computeBeginningBalance(trx, input.bank_account_id);

  const recon = await trx.insertInto('reconciliations').values({
    business_id: bizId,
    bank_account_id: input.bank_account_id,
    statement_beginning_balance: beginningBalance,
    statement_ending_balance: input.statement_ending_balance,
    statement_ending_date: input.statement_ending_date,
    beginning_balance: beginningBalance,
    service_charge_amount: input.service_charge_amount ?? '0',
    service_charge_date: input.service_charge_date ?? null,
    service_charge_account_id: input.service_charge_account_id ?? null,
    interest_earned_amount: input.interest_earned_amount ?? '0',
    interest_earned_date: input.interest_earned_date ?? null,
    interest_earned_account_id: input.interest_earned_account_id ?? null,
    status: 'in_progress',
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  // A service charge or interest amount creates a real, postable transaction
  // (through the normal expense / deposit service, so it gets the same ledger
  // posting, audit trail and void/delete guards as anything else) so it shows
  // up in the worksheet to be cleared, pre-checked since it exists only to
  // account for this statement's own fee or interest line.
  const serviceChargeAmount = parseFloat(input.service_charge_amount ?? '0') || 0;
  if (serviceChargeAmount > 0) {
    if (!input.service_charge_account_id) throw new PreconditionError('An expense account is required for the service charge');
    const expense = await expenseSvc.createExpense(trx, ctx, {
      transaction_date: input.service_charge_date ?? input.statement_ending_date,
      payee_text: bankAccount.institution || bankAccount.name,
      payment_account_id: bankAccount.cash_account_id,
      payment_method: 'other',
      memo: `Bank service charge — reconciling ${bankAccount.name} through ${input.statement_ending_date}`,
      lines: [{ category_account_id: input.service_charge_account_id, amount: serviceChargeAmount.toFixed(2) }],
    });
    await trx.insertInto('reconciliation_items').values({
      reconciliation_id: recon.id,
      transaction_type: 'service_charge',
      transaction_id: expense.id,
      transaction_date: expense.transaction_date,
      description: 'Service charge',
      amount: (-serviceChargeAmount).toFixed(2),
      is_cleared: true,
      cleared_at: sql`now()`,
    }).execute();
  }

  const interestAmount = parseFloat(input.interest_earned_amount ?? '0') || 0;
  if (interestAmount > 0) {
    if (!input.interest_earned_account_id) throw new PreconditionError('An income account is required for interest earned');
    const deposit = await depositSvc.createDeposit(trx, ctx, {
      bank_account_id: input.bank_account_id,
      deposit_date: input.interest_earned_date ?? input.statement_ending_date,
      memo: `Interest earned — reconciling ${bankAccount.name} through ${input.statement_ending_date}`,
      lines: [{
        line_type: 'other_funds',
        account_id: input.interest_earned_account_id,
        description: 'Interest earned',
        amount: interestAmount.toFixed(2),
      }],
    });
    await trx.insertInto('reconciliation_items').values({
      reconciliation_id: recon.id,
      transaction_type: 'interest',
      transaction_id: deposit.id,
      transaction_date: deposit.deposit_date,
      description: 'Interest earned',
      amount: interestAmount.toFixed(2),
      is_cleared: true,
      cleared_at: sql`now()`,
    }).execute();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_START,
    entity_type: 'reconciliation',
    entity_id: recon.id,
    before: null,
    after: recon,
  });

  return recon;
}

/** True once a transaction's own JE was matched through the bank-feed inbox and swept into a bulk review-lock — pre-check it the same way the old bank_transactions-based reconciliation did. */
async function wasBankFeedMatched(db: Kysely<DB> | Transaction<DB>, journal_entry_id: string | null): Promise<boolean> {
  if (!journal_entry_id) return false;
  const row = await db.selectFrom('bank_transactions').select('id')
    .where('matched_journal_entry_id', '=', journal_entry_id)
    .where('status', 'in', ['matched', 'categorized'])
    .executeTakeFirst();
  return row !== undefined;
}

async function savedClearedState(db: Kysely<DB> | Transaction<DB>, reconciliation_id: string) {
  const rows = await db.selectFrom('reconciliation_items')
    .select(['transaction_type', 'transaction_id', 'is_cleared'])
    .where('reconciliation_id', '=', reconciliation_id)
    .execute();
  const map = new Map<string, boolean>();
  for (const r of rows) map.set(`${r.transaction_type}:${r.transaction_id}`, r.is_cleared);
  return map;
}

export async function getWorksheet(db: Kysely<DB>, ctx: ServiceCtx, id: string) {
  const bizId = ctx.business_id!;
  const recon = await db.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  const bankAccount = await resolveBankAccount(db, bizId, recon.bank_account_id);
  const saved = await savedClearedState(db, id);

  const items: WorksheetItem[] = [];

  const deposits = await db.selectFrom('bank_deposits')
    .select(['id', 'deposit_date', 'deposit_number', 'memo', 'total_amount', 'journal_entry_id'])
    .where('bank_account_id', '=', recon.bank_account_id)
    .where('voided_at', 'is', null)
    .where('reconciliation_status', '!=', 'reconciled')
    .where('deposit_date', '<=', recon.statement_ending_date)
    .execute();
  for (const d of deposits) {
    // Interest earned, created at Start, is a bank_deposits row under the hood —
    // its cleared state was saved under the 'interest' item type, not 'deposit'.
    const isInterest = saved.has(`interest:${d.id}`);
    const type: ReconciliationItemType = isInterest ? 'interest' : 'deposit';
    const key = `${type}:${d.id}`;
    items.push({
      transaction_type: type, transaction_id: d.id, transaction_date: d.deposit_date,
      type_label: isInterest ? 'Interest Earned' : 'Deposit', ref_no: d.deposit_number, name: null, description: d.memo,
      amount: toMoneyString(d.total_amount),
      is_cleared: saved.get(key) ?? await wasBankFeedMatched(db, d.journal_entry_id),
      transaction_path: `/accounting/deposits/${d.id}`,
    });
  }

  const expenses = await db.selectFrom('expense_transactions as e')
    .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
    .select(['e.id', 'e.transaction_date', 'e.reference', 'e.payee_text', 'v.name as vendor_name', 'e.memo', 'e.total_amount', 'e.journal_entry_id', 'e.payment_method'])
    .where('e.payment_account_id', '=', bankAccount.cash_account_id)
    .where('e.status', '=', 'posted')
    .where('e.reconciliation_status', '!=', 'reconciled')
    .where('e.transaction_date', '<=', recon.statement_ending_date)
    .execute();
  for (const e of expenses) {
    const isServiceCharge = saved.has(`service_charge:${e.id}`);
    const type: ReconciliationItemType = isServiceCharge ? 'service_charge' : 'expense';
    const key = `${type}:${e.id}`;
    const isCheck = e.payment_method === 'check';
    items.push({
      transaction_type: type, transaction_id: e.id, transaction_date: e.transaction_date,
      type_label: isServiceCharge ? 'Service Charge' : (isCheck ? 'Check' : 'Expense'), ref_no: e.reference, name: e.vendor_name ?? e.payee_text, description: e.memo,
      amount: toMoneyString(`-${e.total_amount}`),
      is_cleared: saved.get(key) ?? await wasBankFeedMatched(db, e.journal_entry_id),
      transaction_path: `/accounting/expenses/${e.id}`,
    });
  }

  const checks = await db.selectFrom('checks as c')
    .leftJoin('vendors as v', 'v.id', 'c.payee_id')
    .select(['c.id', 'c.payment_date', 'c.check_number', 'c.payee_text', 'v.name as vendor_name', 'c.memo', 'c.total_amount', 'c.journal_entry_id'])
    .where('c.bank_account_id', '=', recon.bank_account_id)
    .where('c.status', '=', 'posted')
    .where('c.reconciliation_status', '!=', 'reconciled')
    .where('c.payment_date', '<=', recon.statement_ending_date)
    .execute();
  for (const c of checks) {
    const key = `check:${c.id}`;
    items.push({
      transaction_type: 'check', transaction_id: c.id, transaction_date: c.payment_date,
      type_label: 'Check', ref_no: c.check_number, name: c.vendor_name ?? c.payee_text, description: c.memo,
      amount: toMoneyString(`-${c.total_amount}`),
      is_cleared: saved.get(key) ?? await wasBankFeedMatched(db, c.journal_entry_id),
      transaction_path: `/accounting/checks/${c.id}`,
    });
  }

  // Standalone entries (manual/adjustment/reconciliation_adjustment) that hit
  // the bank's own cash account directly. A deposit/expense/check's own JE
  // already appears above through its wrapper, so entries wrapped by one of
  // those source types are excluded here to avoid listing the same money twice.
  const jeLines = await db.selectFrom('journal_entries as j')
    .innerJoin('journal_entry_lines as l', 'l.journal_entry_id', 'j.id')
    .select(['j.id', 'j.entry_date', 'j.journal_number', 'j.reference', 'j.payee_name', 'j.memo', 'l.debit', 'l.credit'])
    .where('l.account_id', '=', bankAccount.cash_account_id)
    .where('j.status', '=', 'posted')
    .where('j.source_type', 'in', ['manual', 'adjustment'])
    .where('j.reconciliation_status', '!=', 'reconciled')
    .where('j.entry_date', '<=', recon.statement_ending_date)
    .execute();
  for (const j of jeLines) {
    const key = `journal_entry:${j.id}`;
    const amount = toMoneyString(subMoney(toMoneyString(j.debit), toMoneyString(j.credit)));
    if (isZero(amount)) continue;
    items.push({
      transaction_type: 'journal_entry', transaction_id: j.id, transaction_date: j.entry_date,
      type_label: 'Journal Entry', ref_no: j.reference ?? j.journal_number, name: j.payee_name, description: j.memo,
      amount,
      is_cleared: saved.get(key) ?? false,
      transaction_path: `/accounting/journal-entries/${j.id}`,
    });
  }

  items.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

  let clearedBalance = toMoneyString(recon.beginning_balance);
  let clearedCount = 0;
  for (const item of items) {
    if (item.is_cleared) {
      clearedBalance = toMoneyString(addMoney(clearedBalance, item.amount));
      clearedCount++;
    }
  }
  const difference = toMoneyString(subMoney(toMoneyString(recon.statement_ending_balance), clearedBalance));

  return {
    reconciliation: recon,
    bank_account: bankAccount,
    items,
    summary: {
      statement_beginning_balance: toMoneyString(recon.beginning_balance),
      statement_ending_balance: toMoneyString(recon.statement_ending_balance),
      cleared_balance: clearedBalance,
      difference,
      cleared_count: clearedCount,
      total_count: items.length,
    },
  };
}

export async function saveProgress(
  trx: Transaction<DB>, ctx: ServiceCtx,
  id: string,
  inputItems: { transaction_type: ReconciliationItemType; transaction_id: string; is_cleared: boolean }[],
) {
  const bizId = ctx.business_id!;
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).forUpdate().executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  if (recon.status !== 'in_progress') throw new PreconditionError('This reconciliation is no longer in progress');

  // getWorksheet needs the live transaction_date/amount for each row, so read
  // it fresh rather than trust the client — only is_cleared is taken from input.
  const { items: liveItems } = await getWorksheet(trx as unknown as Kysely<DB>, ctx, id);
  const liveByKey = new Map(liveItems.map(i => [`${i.transaction_type}:${i.transaction_id}`, i]));

  for (const input of inputItems) {
    const live = liveByKey.get(`${input.transaction_type}:${input.transaction_id}`);
    if (!live) continue;
    await trx.insertInto('reconciliation_items').values({
      reconciliation_id: id,
      transaction_type: input.transaction_type,
      transaction_id: input.transaction_id,
      transaction_date: live.transaction_date,
      description: live.description,
      amount: live.amount,
      is_cleared: input.is_cleared,
      cleared_at: input.is_cleared ? sql`now()` : null,
    }).onConflict(oc => oc.columns(['reconciliation_id', 'transaction_type', 'transaction_id']).doUpdateSet({
      is_cleared: input.is_cleared,
      cleared_at: input.is_cleared ? sql`now()` : null,
    })).execute();
  }

  const { summary } = await getWorksheet(trx as unknown as Kysely<DB>, ctx, id);
  const updated = await trx.updateTable('reconciliations')
    .set({ difference: summary.difference })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_SAVE,
    entity_type: 'reconciliation',
    entity_id: id,
    before: { difference: recon.difference },
    after: { difference: updated.difference },
  });

  return { reconciliation: updated, summary };
}

const sourceTable: Record<Exclude<ReconciliationItemType, 'service_charge' | 'interest'>, 'bank_deposits' | 'expense_transactions' | 'checks' | 'journal_entries'> = {
  deposit: 'bank_deposits', expense: 'expense_transactions', check: 'checks', journal_entry: 'journal_entries',
};

function tableFor(type: ReconciliationItemType): 'bank_deposits' | 'expense_transactions' | 'checks' | 'journal_entries' {
  if (type === 'service_charge') return 'expense_transactions';
  if (type === 'interest') return 'bank_deposits';
  return sourceTable[type];
}

export async function finishReconciliation(
  trx: Transaction<DB>, ctx: ServiceCtx,
  id: string,
  input: { accept_difference?: boolean; discrepancy_account_id?: string | null },
) {
  const bizId = ctx.business_id!;
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).forUpdate().executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  if (recon.status !== 'in_progress') throw new PreconditionError('This reconciliation is no longer in progress');

  const { items, bank_account, summary } = await getWorksheet(trx as unknown as Kysely<DB>, ctx, id);

  if (!isZero(summary.difference) && !input.accept_difference) {
    throw new PreconditionError(
      `There is a ${summary.difference} difference between the books and the statement`,
      { difference: summary.difference },
    );
  }

  let adjustmentJeId: string | null = null;
  if (!isZero(summary.difference) && input.accept_difference) {
    const discrepancyAccount = input.discrepancy_account_id
      ? await trx.selectFrom('chart_of_accounts').selectAll()
        .where('id', '=', input.discrepancy_account_id).where('business_id', '=', bizId).executeTakeFirst()
      : await getOrCreateOpeningBalanceEquity(trx, ctx, bizId);
    if (!discrepancyAccount) throw new NotFoundError('chart_of_accounts', input.discrepancy_account_id!);

    const diff = parseFloat(summary.difference);
    const absDiff = Math.abs(diff).toFixed(2);
    const adjustment = await ledger.postJournalEntry(trx, ctx, {
      business_id: bizId,
      entry_date: recon.statement_ending_date,
      source_type: 'reconciliation_adjustment',
      source_id: recon.id,
      transaction_type: 'reconciliation_adjustment',
      memo: `Reconciliation adjustment — ${bank_account.name} through ${recon.statement_ending_date}`,
      reference: null,
      lines: diff > 0
        ? [
            { account_id: bank_account.cash_account_id, debit: absDiff, credit: '0', memo: 'Reconciliation adjustment' },
            { account_id: discrepancyAccount.id, debit: '0', credit: absDiff, memo: 'Reconciliation adjustment' },
          ]
        : [
            { account_id: discrepancyAccount.id, debit: absDiff, credit: '0', memo: 'Reconciliation adjustment' },
            { account_id: bank_account.cash_account_id, debit: '0', credit: absDiff, memo: 'Reconciliation adjustment' },
          ],
    });
    adjustmentJeId = adjustment.id;
  }

  // Lock every cleared item's source row as reconciled.
  for (const item of items) {
    if (!item.is_cleared) continue;
    await trx.updateTable(tableFor(item.transaction_type))
      .set({ reconciliation_status: 'reconciled', reconciliation_id: id })
      .where('id', '=', item.transaction_id)
      .execute();
  }

  const clearedItems = items.filter(i => i.is_cleared);
  if (clearedItems.length > 0) {
    await trx.insertInto('reconciliation_items').values(clearedItems.map(i => ({
      reconciliation_id: id,
      transaction_type: i.transaction_type,
      transaction_id: i.transaction_id,
      transaction_date: i.transaction_date,
      description: i.description,
      amount: i.amount,
      is_cleared: true,
      cleared_at: sql`now()`,
    }))).onConflict(oc => oc.columns(['reconciliation_id', 'transaction_type', 'transaction_id']).doUpdateSet({
      is_cleared: true, cleared_at: sql`now()`,
    })).execute();
  }

  const completed = await trx.updateTable('reconciliations')
    .set({
      status: 'completed',
      difference: isZero(summary.difference) ? '0' : summary.difference,
      adjustment_journal_entry_id: adjustmentJeId,
      completed_at: sql`now()`,
      completed_by_user_id: ctx.user_id,
    })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_FINISH,
    entity_type: 'reconciliation',
    entity_id: id,
    before: recon,
    after: completed,
  });

  return completed;
}

export async function cancelReconciliation(trx: Transaction<DB>, ctx: ServiceCtx, id: string) {
  const bizId = ctx.business_id!;
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).forUpdate().executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  if (recon.status !== 'in_progress') throw new PreconditionError('This reconciliation is no longer in progress');

  // Service-charge/interest rows created at Start exist only for this attempt — remove
  // them entirely, JE included. Deleting a journal entry is normally firm-admin-only;
  // this is the system undoing its own Start, not a user-initiated delete, so it runs
  // as if by a firm admin regardless of who is actually cancelling (already accountant+).
  const deleteCtx: ServiceCtx = { ...ctx, effective_role: 'firm_admin' };
  const specialItems = await trx.selectFrom('reconciliation_items').selectAll()
    .where('reconciliation_id', '=', id)
    .where('transaction_type', 'in', ['service_charge', 'interest'])
    .execute();
  for (const item of specialItems) {
    if (item.transaction_type === 'service_charge') {
      await expenseSvc.deleteExpense(trx, deleteCtx, item.transaction_id);
    } else if (item.transaction_type === 'interest') {
      await depositSvc.deleteDeposit(trx, deleteCtx, item.transaction_id);
    }
  }

  await trx.deleteFrom('reconciliation_items').where('reconciliation_id', '=', id).execute();
  const cancelled = await trx.updateTable('reconciliations').set({ status: 'cancelled' })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_CANCEL,
    entity_type: 'reconciliation',
    entity_id: id,
    before: recon,
    after: cancelled,
  });

  return cancelled;
}

export async function listHistory(db: Kysely<DB>, ctx: ServiceCtx, q: { bank_account_id?: string }) {
  let query = db.selectFrom('reconciliations as r')
    .leftJoin('users as u', 'u.id', 'r.completed_by_user_id')
    .leftJoin('bank_accounts as b', 'b.id', 'r.bank_account_id')
    .select(['r.id', 'r.bank_account_id', 'b.name as bank_account_name', 'r.statement_ending_date', 'r.statement_ending_balance', 'r.difference', 'r.status', 'r.completed_at', 'u.full_name as completed_by'])
    .where('r.business_id', '=', ctx.business_id!)
    .where('r.status', 'in', ['completed', 'cancelled']);
  if (q.bank_account_id) query = query.where('r.bank_account_id', '=', q.bank_account_id);
  const rows = await query.orderBy('r.statement_ending_date', 'desc').execute();
  if (rows.length === 0) return [];
  const counts = await db.selectFrom('reconciliation_items')
    .select(['reconciliation_id', ({ fn }) => fn.countAll<string>().as('count')])
    .where('reconciliation_id', 'in', rows.map(r => r.id))
    .where('is_cleared', '=', true)
    .groupBy('reconciliation_id')
    .execute();
  const countMap = new Map(counts.map(c => [c.reconciliation_id, Number(c.count)]));
  return rows.map(r => ({ ...r, items_cleared: countMap.get(r.id) ?? 0 }));
}

export async function getReconciliationDetail(db: Kysely<DB>, ctx: ServiceCtx, id: string) {
  const recon = await db.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', ctx.business_id!).executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  const items = await db.selectFrom('reconciliation_items').selectAll()
    .where('reconciliation_id', '=', id).orderBy('transaction_date').execute();
  return { reconciliation: recon, items };
}

/** Only the latest completed reconciliation on an account may be undone — undoing an older one first requires undoing every newer one. Firm-admin only (checked at the route). */
export async function undoReconciliation(trx: Transaction<DB>, ctx: ServiceCtx, id: string) {
  if (!hasMinRole(ctx.effective_role, 'firm_admin')) {
    throw new PreconditionError('Only a firm admin may undo a reconciliation');
  }
  const bizId = ctx.business_id!;
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).forUpdate().executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  if (recon.status !== 'completed') throw new PreconditionError('Only a completed reconciliation can be undone');

  const latest = await trx.selectFrom('reconciliations').select('id')
    .where('bank_account_id', '=', recon.bank_account_id).where('status', '=', 'completed')
    .orderBy('statement_ending_date', 'desc').executeTakeFirst();
  if (latest?.id !== id) {
    throw new PreconditionError('Only the most recent reconciliation on this account can be undone — undo the newer ones first');
  }

  const items = await trx.selectFrom('reconciliation_items').selectAll()
    .where('reconciliation_id', '=', id).where('is_cleared', '=', true).execute();
  for (const item of items) {
    await trx.updateTable(tableFor(item.transaction_type))
      .set({ reconciliation_status: 'unreconciled', reconciliation_id: null })
      .where('id', '=', item.transaction_id)
      .where('reconciliation_id', '=', id)
      .execute();
  }

  if (recon.adjustment_journal_entry_id) {
    await ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: recon.adjustment_journal_entry_id,
      void_reason: `Reconciliation of ${recon.statement_ending_date} undone`,
      reversal_date: recon.statement_ending_date,
      source_guard: { source_type: 'reconciliation_adjustment', source_id: recon.id },
    });
  }

  const undone = await trx.updateTable('reconciliations')
    .set({ status: 'in_progress', completed_at: null, completed_by_user_id: null, adjustment_journal_entry_id: null })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_UNDO,
    entity_type: 'reconciliation',
    entity_id: id,
    before: recon,
    after: undone,
  });

  return undone;
}
