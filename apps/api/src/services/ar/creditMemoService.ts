import { type Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, subMoney, toMoneyString, equalMoney } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { OverApplicationError } from '../../lib/arErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import { getSystemAccount } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateDraftCreditMemoInput = {
  business_id: string;
  customer_id: string;
  memo_date: string;
  amount: string;
  revenue_account_id: string;
  memo: string | null;
};

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftCreditMemoInput) {
  if (parseFloat(input.amount) <= 0) throw new PreconditionError('amount must be > 0');
  const ar = await getSystemAccount(trx as unknown as Kysely<DB>, input.business_id, '1100');
  const row = await trx.insertInto('credit_memos').values({
    business_id: input.business_id, customer_id: input.customer_id,
    memo_date: input.memo_date,
    amount: input.amount, remaining_amount: input.amount,
    revenue_account_id: input.revenue_account_id,
    ar_account_id: ar.id, memo: input.memo,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.CREDIT_MEMO_CREATE, entity_type: 'credit_memo', entity_id: row.id, before: null, after: row });
  return row;
}

export async function postCreditMemo(trx: Transaction<DB>, ctx: ServiceCtx, input: { credit_memo_id: string }) {
  const cm = await trx.selectFrom('credit_memos').selectAll().where('id', '=', input.credit_memo_id).executeTakeFirst();
  if (!cm) throw new NotFoundError('credit_memo', input.credit_memo_id);
  if (cm.status !== 'draft') throw new InvalidStateTransitionError('credit_memo', cm.id, cm.status, 'posted');

  const je = await postJournalEntry(trx, ctx, {
    business_id: cm.business_id, entry_date: cm.memo_date,
    source_type: 'credit_memo', source_id: cm.id,
    memo: `Credit memo for customer`, reference: null,
    lines: [
      { account_id: cm.revenue_account_id, debit: cm.amount, credit: '0.0000', memo: null },
      { account_id: cm.ar_account_id,      debit: '0.0000', credit: cm.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('credit_memos')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', cm.id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.CREDIT_MEMO_POST, entity_type: 'credit_memo', entity_id: cm.id, before: cm, after: updated });
  return updated;
}

export async function applyToInvoice(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { credit_memo_id: string; invoice_id: string; applied_amount: string },
) {
  if (parseFloat(input.applied_amount) <= 0) throw new PreconditionError('applied_amount must be > 0');
  const cm = await trx.selectFrom('credit_memos').selectAll().where('id', '=', input.credit_memo_id).executeTakeFirst();
  if (!cm) throw new NotFoundError('credit_memo', input.credit_memo_id);
  if (cm.status !== 'posted' && cm.status !== 'applied') throw new InvalidStateTransitionError('credit_memo', cm.id, cm.status, 'apply');
  if (parseFloat(input.applied_amount) > parseFloat(cm.remaining_amount)) {
    throw new OverApplicationError('credit_memo', cm.id, input.applied_amount, cm.remaining_amount);
  }

  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.business_id !== cm.business_id) throw new PreconditionError('credit_memo + invoice must be same business');
  if (inv.customer_id !== cm.customer_id) throw new PreconditionError('credit_memo + invoice must be same customer');
  if (inv.status === 'voided') throw new InvalidStateTransitionError('invoice', inv.id, 'voided', 'apply');

  const appliedRow = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as c', 'c.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', inv.id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('c.status', 'in', ['posted','applied'])]))
    .executeTakeFirst();
  const amount_due = toMoneyString(subMoney(inv.total, appliedRow?.applied ?? '0'));
  if (parseFloat(input.applied_amount) > parseFloat(amount_due)) {
    throw new OverApplicationError('invoice', inv.id, input.applied_amount, amount_due);
  }

  await trx.insertInto('payment_applications').values({
    credit_memo_id: cm.id, invoice_id: inv.id,
    applied_amount: input.applied_amount, applied_by_user_id: ctx.user_id,
  }).execute();

  const newRemaining = toMoneyString(subMoney(cm.remaining_amount, input.applied_amount));
  await trx.updateTable('credit_memos')
    .set({ remaining_amount: newRemaining, status: equalMoney(newRemaining, '0') ? 'applied' : cm.status })
    .where('id', '=', cm.id).execute();

  // Possibly mark invoice paid
  const r2 = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as c', 'c.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', inv.id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('c.status', 'in', ['posted','applied'])]))
    .executeTakeFirst();
  if (equalMoney(r2?.applied ?? '0', inv.total) && inv.status === 'posted') {
    await trx.updateTable('invoices').set({ status: 'paid' }).where('id', '=', inv.id).execute();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.CREDIT_MEMO_APPLY, entity_type: 'payment_application', entity_id: null,
    before: null, after: { credit_memo_id: cm.id, invoice_id: inv.id, applied_amount: input.applied_amount },
  });
}

export async function voidCreditMemo(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { credit_memo_id: string; void_reason: string },
) {
  const cm = await trx.selectFrom('credit_memos').selectAll().where('id', '=', input.credit_memo_id).executeTakeFirst();
  if (!cm) throw new NotFoundError('credit_memo', input.credit_memo_id);
  if (cm.status !== 'posted' && cm.status !== 'applied') throw new InvalidStateTransitionError('credit_memo', cm.id, cm.status, 'voided');

  // Refuse if any active applications exist
  const apps = await trx.selectFrom('payment_applications').select('id').where('credit_memo_id', '=', cm.id).execute();
  if (apps.length > 0) throw new PreconditionError(`Credit memo has ${apps.length} active application(s); unapply before voiding`, { application_ids: apps.map(a => a.id) });

  if (!cm.posted_journal_entry_id) throw new PreconditionError('credit_memo has no JE to reverse');
  await voidJournalEntry(trx, ctx, { journal_entry_id: cm.posted_journal_entry_id, void_reason: `Void credit memo: ${input.void_reason}` });

  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('credit_memos')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', cm.id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.CREDIT_MEMO_VOID, entity_type: 'credit_memo', entity_id: cm.id, before: cm, after: updated });
  return updated;
}

export async function listCreditMemos(db: Kysely<DB>, q: { business_id: string; customer_id?: string }) {
  let qb = db.selectFrom('credit_memos').selectAll().where('business_id', '=', q.business_id);
  if (q.customer_id) qb = qb.where('customer_id', '=', q.customer_id);
  return qb.orderBy('memo_date', 'desc').execute();
}
