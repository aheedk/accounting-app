import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';

export type CreateDraftInput = {
  business_id: string;
  transaction_date: string;
  payee_text?: string | null;
  vendor_id?: string | null;
  expense_account_id: string;
  payment_account_id: string;
  amount: string;
  memo?: string | null;
};

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftInput) {
  if (!input.payee_text && !input.vendor_id) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'payee_text or vendor_id required');
  }
  const exp = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.expense_account_id).where('business_id', '=', input.business_id).executeTakeFirst();
  if (!exp) throw new NotFoundError('chart_of_accounts', input.expense_account_id);
  if (exp.account_type !== 'expense') {
    throw new PreconditionError('expense_account_id must be an expense account');
  }
  const pay = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.payment_account_id).where('business_id', '=', input.business_id).executeTakeFirst();
  if (!pay) throw new NotFoundError('chart_of_accounts', input.payment_account_id);
  if (pay.account_type !== 'asset' && pay.account_type !== 'liability') {
    throw new PreconditionError('payment_account_id must be asset (cash/bank) or liability (credit card)');
  }

  const row = await trx.insertInto('expense_transactions').values({
    business_id: input.business_id,
    transaction_date: input.transaction_date,
    payee_text: input.payee_text ?? null,
    vendor_id: input.vendor_id ?? null,
    expense_account_id: input.expense_account_id,
    payment_account_id: input.payment_account_id,
    amount: input.amount,
    memo: input.memo ?? null,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_CREATE,
    entity_type: 'expense_transaction', entity_id: row.id,
    before: null, after: row,
  });
  return row;
}

export async function post(trx: Transaction<DB>, ctx: ServiceCtx, input: { expense_transaction_id: string }) {
  const before = await trx.selectFrom('expense_transactions').selectAll()
    .where('id', '=', input.expense_transaction_id).executeTakeFirst();
  if (!before) throw new NotFoundError('expense_transaction', input.expense_transaction_id);
  if (before.status !== 'draft') throw new PreconditionError(`expense transaction is ${before.status}, not draft`);

  const je = await postJournalEntry(trx, ctx, {
    business_id: before.business_id,
    entry_date: before.transaction_date,
    source_type: 'manual',
    memo: before.memo ?? `Expense — ${before.payee_text ?? 'vendor'}`,
    reference: null,
    lines: [
      { account_id: before.expense_account_id, debit: before.amount, credit: '0', memo: null },
      { account_id: before.payment_account_id, debit: '0', credit: before.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('expense_transactions').set({
    status: 'posted',
    journal_entry_id: je.id,
    posted_at: sql`now()`,
    posted_by_user_id: ctx.user_id,
  }).where('id', '=', input.expense_transaction_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_POST,
    entity_type: 'expense_transaction', entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}

export async function voidExpense(trx: Transaction<DB>, ctx: ServiceCtx, input: { expense_transaction_id: string; void_reason?: string }) {
  const before = await trx.selectFrom('expense_transactions').selectAll()
    .where('id', '=', input.expense_transaction_id).executeTakeFirst();
  if (!before) throw new NotFoundError('expense_transaction', input.expense_transaction_id);
  if (before.status === 'void') throw new PreconditionError('already void');

  if (before.status === 'posted' && before.journal_entry_id) {
    await voidJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      void_reason: input.void_reason ?? 'expense voided',
    });
  }

  // CHECK constraints are now one-way implications: posted requires JE+posted_at,
  // draft forbids both, void allows either. We KEEP journal_entry_id + posted_at on
  // void rows so the audit trail can see what was reversed.
  const updated = await trx.updateTable('expense_transactions').set({
    status: 'void',
    voided_at: sql`now()`,
    voided_by_user_id: ctx.user_id,
  }).where('id', '=', input.expense_transaction_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_VOID,
    entity_type: 'expense_transaction', entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}

export async function listExpenses(db: Kysely<DB>, business_id: string, opts: { status?: 'draft' | 'posted' | 'void' } = {}) {
  let q = db.selectFrom('expense_transactions').selectAll()
    .where('business_id', '=', business_id);
  if (opts.status) q = q.where('status', '=', opts.status);
  return q.orderBy('transaction_date', 'desc').execute();
}

export async function getExpense(db: Kysely<DB>, business_id: string, id: string) {
  const row = await db.selectFrom('expense_transactions').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!row) throw new NotFoundError('expense_transaction', id);
  return row;
}
