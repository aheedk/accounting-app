import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, addMoney, subMoney, toMoneyString, equalMoney } from '@accounting/shared';
import type { DB, PaymentMethod, BillPaymentStatus } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { OverApplicationError } from '../../lib/arErrors.js';
import { BillPaymentHasApplicationsError } from '../../lib/apErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import { getSystemAccount } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateDraftBillPaymentInput = {
  business_id: string;
  vendor_id: string;
  payment_date: string;
  payment_method: PaymentMethod;
  reference: string | null;
  amount: string;
  cash_account_id: string;
  memo: string | null;
  initial_applications?: Array<{ bill_id: string; applied_amount: string }>;
};

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftBillPaymentInput) {
  if (parseFloat(input.amount) <= 0) throw new PreconditionError('Bill payment amount must be > 0');

  const vendor = await trx.selectFrom('vendors').selectAll().where('id', '=', input.vendor_id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!vendor || vendor.business_id !== input.business_id) throw new NotFoundError('vendor', input.vendor_id);

  const cash = await trx.selectFrom('chart_of_accounts').selectAll().where('id', '=', input.cash_account_id).executeTakeFirst();
  if (!cash || cash.business_id !== input.business_id || cash.account_type !== 'asset') {
    throw new PreconditionError('cash_account must be an asset account in this business');
  }

  const initialAppliedTotal = (input.initial_applications ?? []).reduce<string>(
    (s, a) => toMoneyString(addMoney(s, a.applied_amount)),
    '0',
  );
  if (parseFloat(initialAppliedTotal) > parseFloat(input.amount)) {
    throw new OverApplicationError('bill_payment', '(draft)', initialAppliedTotal, input.amount);
  }

  const bill_payment = await trx.insertInto('bill_payments').values({
    business_id: input.business_id,
    vendor_id: input.vendor_id,
    payment_date: input.payment_date,
    payment_method: input.payment_method,
    reference: input.reference,
    amount: input.amount,
    unapplied_amount: input.amount,
    cash_account_id: input.cash_account_id,
    memo: input.memo,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  for (const a of input.initial_applications ?? []) {
    await applyToBillInternal(trx, ctx, { bill_payment_id: bill_payment.id, bill_id: a.bill_id, applied_amount: a.applied_amount, audit: false });
  }

  await auditRecord(trx, ctx, { action: AUDIT.BILL_PAYMENT_CREATE, entity_type: 'bill_payment', entity_id: bill_payment.id, before: null, after: bill_payment });
  return { bill_payment };
}

export async function postBillPayment(trx: Transaction<DB>, ctx: ServiceCtx, input: { bill_payment_id: string }) {
  const payment = await trx.selectFrom('bill_payments').selectAll().where('id', '=', input.bill_payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('bill_payment', input.bill_payment_id);
  if (payment.status !== 'draft') throw new InvalidStateTransitionError('bill_payment', payment.id, payment.status, 'posted');

  const apAccount = await getSystemAccount(trx as unknown as Kysely<DB>, payment.business_id, '2010');

  const je = await postJournalEntry(trx, ctx, {
    business_id: payment.business_id,
    entry_date: payment.payment_date,
    source_type: 'bill_payment',
    source_id: payment.id,
    memo: `Payment to vendor (${payment.payment_method})`,
    reference: payment.reference,
    lines: [
      { account_id: apAccount.id,             debit: payment.amount, credit: '0.0000',       memo: null },
      { account_id: payment.cash_account_id,  debit: '0.0000',       credit: payment.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('bill_payments')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', payment.id)
    .returningAll().executeTakeFirstOrThrow();

  // Re-evaluate any bills the payment is already applied to (they may flip to 'paid' now)
  const apps = await trx.selectFrom('bill_payment_applications').select('bill_id').where('bill_payment_id', '=', payment.id).execute();
  for (const a of apps) await maybeMarkBillPaid(trx, ctx, a.bill_id);

  await auditRecord(trx, ctx, { action: AUDIT.BILL_PAYMENT_POST, entity_type: 'bill_payment', entity_id: payment.id, before: payment, after: updated });
  return updated;
}

async function applyToBillInternal(
  trx: Transaction<DB>, ctx: ServiceCtx,
  args: { bill_payment_id: string; bill_id: string; applied_amount: string; audit: boolean },
) {
  const payment = await trx.selectFrom('bill_payments').selectAll().where('id', '=', args.bill_payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('bill_payment', args.bill_payment_id);
  if (payment.status === 'voided') throw new InvalidStateTransitionError('bill_payment', payment.id, 'voided', 'apply');
  if (parseFloat(args.applied_amount) <= 0) throw new PreconditionError('applied_amount must be > 0');
  if (parseFloat(args.applied_amount) > parseFloat(payment.unapplied_amount)) {
    throw new OverApplicationError('bill_payment', payment.id, args.applied_amount, payment.unapplied_amount);
  }

  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', args.bill_id).executeTakeFirst();
  if (!bill) throw new NotFoundError('bill', args.bill_id);
  if (bill.business_id !== payment.business_id) throw new PreconditionError('bill_payment + bill must be same business');
  if (bill.vendor_id !== payment.vendor_id) throw new PreconditionError('bill_payment + bill must be same vendor');
  if (bill.status === 'voided') throw new InvalidStateTransitionError('bill', bill.id, 'voided', 'apply');

  // amount_due
  const appliedRow = await trx.selectFrom('bill_payment_applications as pa')
    .leftJoin('bill_payments as p', 'p.id', 'pa.bill_payment_id')
    .leftJoin('vendor_credits as c', 'c.id', 'pa.vendor_credit_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.bill_id', '=', args.bill_id)
    .where(eb => eb.or([eb('p.status', 'in', ['draft','posted']), eb('c.status', 'in', ['draft','posted','applied'])]))
    .executeTakeFirst();
  const applied = appliedRow?.applied ?? '0';
  const amount_due = toMoneyString(subMoney(bill.total, applied));
  if (parseFloat(args.applied_amount) > parseFloat(amount_due)) {
    throw new OverApplicationError('bill', bill.id, args.applied_amount, amount_due);
  }

  await trx.insertInto('bill_payment_applications').values({
    bill_payment_id: args.bill_payment_id, bill_id: args.bill_id,
    applied_amount: args.applied_amount, applied_by_user_id: ctx.user_id,
  }).execute();
  await trx.updateTable('bill_payments')
    .set({ unapplied_amount: toMoneyString(subMoney(payment.unapplied_amount, args.applied_amount)) })
    .where('id', '=', args.bill_payment_id).execute();

  if (payment.status === 'posted') await maybeMarkBillPaid(trx, ctx, args.bill_id);

  if (args.audit) {
    await auditRecord(trx, ctx, {
      action: AUDIT.BILL_PAYMENT_APPLY, entity_type: 'bill_payment_application', entity_id: null,
      before: null, after: { bill_payment_id: args.bill_payment_id, bill_id: args.bill_id, applied_amount: args.applied_amount },
    });
  }
}

export async function addApplication(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { bill_payment_id: string; bill_id: string; applied_amount: string },
) {
  await applyToBillInternal(trx, ctx, { ...input, audit: true });
  return trx.selectFrom('bill_payments').selectAll().where('id', '=', input.bill_payment_id).executeTakeFirstOrThrow();
}

export async function removeApplication(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { bill_payment_id: string; application_id: string },
) {
  const payment = await trx.selectFrom('bill_payments').selectAll().where('id', '=', input.bill_payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('bill_payment', input.bill_payment_id);
  const app = await trx.selectFrom('bill_payment_applications').selectAll().where('id', '=', input.application_id).executeTakeFirst();
  if (!app || app.bill_payment_id !== input.bill_payment_id) throw new NotFoundError('bill_payment_application', input.application_id);

  await trx.deleteFrom('bill_payment_applications').where('id', '=', app.id).execute();
  await trx.updateTable('bill_payments')
    .set({ unapplied_amount: toMoneyString(addMoney(payment.unapplied_amount, app.applied_amount)) })
    .where('id', '=', payment.id).execute();

  // Possibly un-pay the bill
  if (app.bill_id) await maybeUnmarkBillPaid(trx, ctx, app.bill_id);

  await auditRecord(trx, ctx, {
    action: AUDIT.BILL_PAYMENT_UNAPPLY, entity_type: 'bill_payment_application', entity_id: app.id,
    before: app, after: null,
  });
}

export async function voidBillPayment(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { bill_payment_id: string; void_reason: string },
) {
  const payment = await trx.selectFrom('bill_payments').selectAll().where('id', '=', input.bill_payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('bill_payment', input.bill_payment_id);
  if (payment.status !== 'posted') throw new InvalidStateTransitionError('bill_payment', payment.id, payment.status, 'voided');

  const apps = await trx.selectFrom('bill_payment_applications').select('id').where('bill_payment_id', '=', payment.id).execute();
  if (apps.length > 0) throw new BillPaymentHasApplicationsError(payment.id, apps.length);

  if (!payment.posted_journal_entry_id) throw new PreconditionError('Bill payment has no JE to reverse');
  await voidJournalEntry(trx, ctx, { journal_entry_id: payment.posted_journal_entry_id, void_reason: `Void bill payment: ${input.void_reason}` });

  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('bill_payments')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', payment.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.BILL_PAYMENT_VOID, entity_type: 'bill_payment', entity_id: payment.id, before: payment, after: updated });
  return updated;
}

async function maybeMarkBillPaid(trx: Transaction<DB>, _ctx: ServiceCtx, bill_id: string) {
  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', bill_id).executeTakeFirst();
  if (!bill || bill.status !== 'posted') return;
  const r = await trx.selectFrom('bill_payment_applications as pa')
    .leftJoin('bill_payments as p', 'p.id', 'pa.bill_payment_id')
    .leftJoin('vendor_credits as c', 'c.id', 'pa.vendor_credit_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.bill_id', '=', bill_id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('c.status', 'in', ['posted', 'applied'])]))
    .executeTakeFirst();
  if (equalMoney(r?.applied ?? '0', bill.total)) {
    await trx.updateTable('bills').set({ status: 'paid' }).where('id', '=', bill_id).execute();
  }
}

async function maybeUnmarkBillPaid(trx: Transaction<DB>, _ctx: ServiceCtx, bill_id: string) {
  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', bill_id).executeTakeFirst();
  if (!bill || bill.status !== 'paid') return;
  const r = await trx.selectFrom('bill_payment_applications as pa')
    .leftJoin('bill_payments as p', 'p.id', 'pa.bill_payment_id')
    .leftJoin('vendor_credits as c', 'c.id', 'pa.vendor_credit_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.bill_id', '=', bill_id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('c.status', 'in', ['posted', 'applied'])]))
    .executeTakeFirst();
  if (!equalMoney(r?.applied ?? '0', bill.total)) {
    await trx.updateTable('bills').set({ status: 'posted' }).where('id', '=', bill_id).execute();
  }
}

export async function getBillPaymentWithApplications(db: Kysely<DB>, business_id: string, bill_payment_id: string) {
  const p = await db.selectFrom('bill_payments').selectAll().where('id', '=', bill_payment_id).where('business_id', '=', business_id).executeTakeFirst();
  if (!p) throw new NotFoundError('bill_payment', bill_payment_id);
  const apps = await db.selectFrom('bill_payment_applications as pa')
    .innerJoin('bills as b', 'b.id', 'pa.bill_id')
    .select(['pa.id', 'pa.bill_id', 'b.bill_number', 'pa.applied_amount', 'pa.applied_at'])
    .where('pa.bill_payment_id', '=', bill_payment_id).execute();
  return { bill_payment: p, applications: apps };
}

export async function listBillPayments(db: Kysely<DB>, q: { business_id: string; vendor_id?: string; status?: string }) {
  let qb = db.selectFrom('bill_payments').selectAll().where('business_id', '=', q.business_id);
  if (q.vendor_id) qb = qb.where('vendor_id', '=', q.vendor_id);
  if (q.status) qb = qb.where('status', '=', q.status as BillPaymentStatus);
  return qb.orderBy('payment_date', 'desc').execute();
}
