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

export type CreateDraftVendorCreditInput = {
  business_id: string;
  vendor_id: string;
  credit_date: string;
  amount: string;
  offset_account_id: string;
  memo: string | null;
};

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftVendorCreditInput) {
  if (parseFloat(input.amount) <= 0) throw new PreconditionError('amount must be > 0');
  const ap = await getSystemAccount(trx as unknown as Kysely<DB>, input.business_id, '2010');
  const row = await trx.insertInto('vendor_credits').values({
    business_id: input.business_id, vendor_id: input.vendor_id,
    credit_date: input.credit_date,
    amount: input.amount, remaining_amount: input.amount,
    offset_account_id: input.offset_account_id,
    ap_account_id: ap.id, memo: input.memo,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.VENDOR_CREDIT_CREATE, entity_type: 'vendor_credit', entity_id: row.id, before: null, after: row });
  return row;
}

export async function postVendorCredit(trx: Transaction<DB>, ctx: ServiceCtx, input: { vendor_credit_id: string }) {
  const vc = await trx.selectFrom('vendor_credits').selectAll().where('id', '=', input.vendor_credit_id).executeTakeFirst();
  if (!vc) throw new NotFoundError('vendor_credit', input.vendor_credit_id);
  if (vc.status !== 'draft') throw new InvalidStateTransitionError('vendor_credit', vc.id, vc.status, 'posted');

  const je = await postJournalEntry(trx, ctx, {
    business_id: vc.business_id, entry_date: vc.credit_date,
    source_type: 'vendor_credit', source_id: vc.id,
    memo: `Vendor credit`, reference: null,
    lines: [
      { account_id: vc.ap_account_id,      debit: vc.amount, credit: '0.0000', memo: null },
      { account_id: vc.offset_account_id,  debit: '0.0000', credit: vc.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('vendor_credits')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', vc.id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.VENDOR_CREDIT_POST, entity_type: 'vendor_credit', entity_id: vc.id, before: vc, after: updated });
  return updated;
}

export async function applyToBill(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { vendor_credit_id: string; bill_id: string; applied_amount: string },
) {
  if (parseFloat(input.applied_amount) <= 0) throw new PreconditionError('applied_amount must be > 0');
  const vc = await trx.selectFrom('vendor_credits').selectAll().where('id', '=', input.vendor_credit_id).executeTakeFirst();
  if (!vc) throw new NotFoundError('vendor_credit', input.vendor_credit_id);
  if (vc.status !== 'posted' && vc.status !== 'applied') throw new InvalidStateTransitionError('vendor_credit', vc.id, vc.status, 'apply');
  if (parseFloat(input.applied_amount) > parseFloat(vc.remaining_amount)) {
    throw new OverApplicationError('vendor_credit', vc.id, input.applied_amount, vc.remaining_amount);
  }

  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', input.bill_id).executeTakeFirst();
  if (!bill) throw new NotFoundError('bill', input.bill_id);
  if (bill.business_id !== vc.business_id) throw new PreconditionError('vendor_credit + bill must be same business');
  if (bill.vendor_id !== vc.vendor_id) throw new PreconditionError('vendor_credit + bill must be same vendor');
  if (bill.status === 'voided') throw new InvalidStateTransitionError('bill', bill.id, 'voided', 'apply');

  const appliedRow = await trx.selectFrom('bill_payment_applications as pa')
    .leftJoin('bill_payments as p', 'p.id', 'pa.bill_payment_id')
    .leftJoin('vendor_credits as c', 'c.id', 'pa.vendor_credit_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.bill_id', '=', bill.id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('c.status', 'in', ['posted','applied'])]))
    .executeTakeFirst();
  const amount_due = toMoneyString(subMoney(bill.total, appliedRow?.applied ?? '0'));
  if (parseFloat(input.applied_amount) > parseFloat(amount_due)) {
    throw new OverApplicationError('bill', bill.id, input.applied_amount, amount_due);
  }

  await trx.insertInto('bill_payment_applications').values({
    vendor_credit_id: vc.id, bill_id: bill.id,
    applied_amount: input.applied_amount, applied_by_user_id: ctx.user_id,
  }).execute();

  const newRemaining = toMoneyString(subMoney(vc.remaining_amount, input.applied_amount));
  await trx.updateTable('vendor_credits')
    .set({ remaining_amount: newRemaining, status: equalMoney(newRemaining, '0') ? 'applied' : vc.status })
    .where('id', '=', vc.id).execute();

  // Possibly mark bill paid
  const r2 = await trx.selectFrom('bill_payment_applications as pa')
    .leftJoin('bill_payments as p', 'p.id', 'pa.bill_payment_id')
    .leftJoin('vendor_credits as c', 'c.id', 'pa.vendor_credit_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.bill_id', '=', bill.id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('c.status', 'in', ['posted','applied'])]))
    .executeTakeFirst();
  if (equalMoney(r2?.applied ?? '0', bill.total) && bill.status === 'posted') {
    await trx.updateTable('bills').set({ status: 'paid' }).where('id', '=', bill.id).execute();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.VENDOR_CREDIT_APPLY, entity_type: 'bill_payment_application', entity_id: null,
    before: null, after: { vendor_credit_id: vc.id, bill_id: bill.id, applied_amount: input.applied_amount },
  });
}

export async function voidVendorCredit(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { vendor_credit_id: string; void_reason: string },
) {
  const vc = await trx.selectFrom('vendor_credits').selectAll().where('id', '=', input.vendor_credit_id).executeTakeFirst();
  if (!vc) throw new NotFoundError('vendor_credit', input.vendor_credit_id);
  if (vc.status !== 'posted' && vc.status !== 'applied') throw new InvalidStateTransitionError('vendor_credit', vc.id, vc.status, 'voided');

  // Refuse if any active applications exist
  const apps = await trx.selectFrom('bill_payment_applications').select('id').where('vendor_credit_id', '=', vc.id).execute();
  if (apps.length > 0) throw new PreconditionError(`Vendor credit has ${apps.length} active application(s); unapply before voiding`, { application_ids: apps.map(a => a.id) });

  if (!vc.posted_journal_entry_id) throw new PreconditionError('vendor_credit has no JE to reverse');
  await voidJournalEntry(trx, ctx, { journal_entry_id: vc.posted_journal_entry_id, void_reason: `Void vendor credit: ${input.void_reason}` });

  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('vendor_credits')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', vc.id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.VENDOR_CREDIT_VOID, entity_type: 'vendor_credit', entity_id: vc.id, before: vc, after: updated });
  return updated;
}

export async function listVendorCredits(db: Kysely<DB>, q: { business_id: string; vendor_id?: string }) {
  let qb = db.selectFrom('vendor_credits').selectAll().where('business_id', '=', q.business_id);
  if (q.vendor_id) qb = qb.where('vendor_id', '=', q.vendor_id);
  return qb.orderBy('credit_date', 'desc').execute();
}
