import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, addMoney, subMoney, toMoneyString, equalMoney } from '@accounting/shared';
import type { DB, PaymentMethod, PaymentStatus } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { OverApplicationError, PaymentHasApplicationsError } from '../../lib/arErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import { getSystemAccount } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateDraftPaymentInput = {
  business_id: string;
  customer_id: string;
  payment_date: string;
  payment_method: PaymentMethod;
  reference: string | null;
  amount: string;
  cash_account_id: string;
  memo: string | null;
  initial_applications?: Array<{ invoice_id: string; applied_amount: string }>;
};

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftPaymentInput) {
  if (parseFloat(input.amount) <= 0) throw new PreconditionError('Payment amount must be > 0');

  const customer = await trx.selectFrom('customers').selectAll().where('id', '=', input.customer_id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!customer || customer.business_id !== input.business_id) throw new NotFoundError('customer', input.customer_id);

  const cash = await trx.selectFrom('chart_of_accounts').selectAll().where('id', '=', input.cash_account_id).executeTakeFirst();
  if (!cash || cash.business_id !== input.business_id || cash.account_type !== 'asset') {
    throw new PreconditionError('cash_account must be an asset account in this business');
  }

  const initialAppliedTotal = (input.initial_applications ?? []).reduce<string>(
    (s, a) => toMoneyString(addMoney(s, a.applied_amount)),
    '0',
  );
  if (parseFloat(initialAppliedTotal) > parseFloat(input.amount)) {
    throw new OverApplicationError('payment', '(draft)', initialAppliedTotal, input.amount);
  }

  const payment = await trx.insertInto('payments').values({
    business_id: input.business_id,
    customer_id: input.customer_id,
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
    await applyToInvoiceInternal(trx, ctx, { payment_id: payment.id, invoice_id: a.invoice_id, applied_amount: a.applied_amount, audit: false });
  }

  await auditRecord(trx, ctx, { action: AUDIT.PAYMENT_CREATE, entity_type: 'payment', entity_id: payment.id, before: null, after: payment });
  return { payment };
}

export async function postPayment(trx: Transaction<DB>, ctx: ServiceCtx, input: { payment_id: string }) {
  const payment = await trx.selectFrom('payments').selectAll().where('id', '=', input.payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('payment', input.payment_id);
  if (payment.status !== 'draft') throw new InvalidStateTransitionError('payment', payment.id, payment.status, 'posted');

  const arAccount = await getSystemAccount(trx as unknown as Kysely<DB>, payment.business_id, '1100');

  const je = await postJournalEntry(trx, ctx, {
    business_id: payment.business_id,
    entry_date: payment.payment_date,
    source_type: 'payment',
    source_id: payment.id,
    memo: `Payment from customer (${payment.payment_method})`,
    reference: payment.reference,
    lines: [
      { account_id: payment.cash_account_id, debit: payment.amount, credit: '0.0000', memo: null },
      { account_id: arAccount.id,            debit: '0.0000',       credit: payment.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('payments')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', payment.id)
    .returningAll().executeTakeFirstOrThrow();

  // Re-evaluate any invoices the payment is already applied to (they may flip to 'paid' now)
  const apps = await trx.selectFrom('payment_applications').select('invoice_id').where('payment_id', '=', payment.id).execute();
  for (const a of apps) await maybeMarkInvoicePaid(trx, ctx, a.invoice_id);

  await auditRecord(trx, ctx, { action: AUDIT.PAYMENT_POST, entity_type: 'payment', entity_id: payment.id, before: payment, after: updated });
  return updated;
}

async function applyToInvoiceInternal(
  trx: Transaction<DB>, ctx: ServiceCtx,
  args: { payment_id: string; invoice_id: string; applied_amount: string; audit: boolean },
) {
  const payment = await trx.selectFrom('payments').selectAll().where('id', '=', args.payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('payment', args.payment_id);
  if (payment.status === 'voided') throw new InvalidStateTransitionError('payment', payment.id, 'voided', 'apply');
  if (parseFloat(args.applied_amount) <= 0) throw new PreconditionError('applied_amount must be > 0');
  if (parseFloat(args.applied_amount) > parseFloat(payment.unapplied_amount)) {
    throw new OverApplicationError('payment', payment.id, args.applied_amount, payment.unapplied_amount);
  }

  const invoice = await trx.selectFrom('invoices').selectAll().where('id', '=', args.invoice_id).executeTakeFirst();
  if (!invoice) throw new NotFoundError('invoice', args.invoice_id);
  if (invoice.business_id !== payment.business_id) throw new PreconditionError('payment + invoice must be same business');
  if (invoice.customer_id !== payment.customer_id) throw new PreconditionError('payment + invoice must be same customer');
  if (invoice.status === 'voided') throw new InvalidStateTransitionError('invoice', invoice.id, 'voided', 'apply');

  // amount_due
  const appliedRow = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', args.invoice_id)
    .where(eb => eb.or([eb('p.status', 'in', ['draft','posted']), eb('cm.status', 'in', ['draft','posted','applied'])]))
    .executeTakeFirst();
  const applied = appliedRow?.applied ?? '0';
  const amount_due = toMoneyString(subMoney(invoice.total, applied));
  if (parseFloat(args.applied_amount) > parseFloat(amount_due)) {
    throw new OverApplicationError('invoice', invoice.id, args.applied_amount, amount_due);
  }

  await trx.insertInto('payment_applications').values({
    payment_id: args.payment_id, invoice_id: args.invoice_id,
    applied_amount: args.applied_amount, applied_by_user_id: ctx.user_id,
  }).execute();
  await trx.updateTable('payments')
    .set({ unapplied_amount: toMoneyString(subMoney(payment.unapplied_amount, args.applied_amount)) })
    .where('id', '=', args.payment_id).execute();

  if (payment.status === 'posted') await maybeMarkInvoicePaid(trx, ctx, args.invoice_id);

  if (args.audit) {
    await auditRecord(trx, ctx, {
      action: AUDIT.PAYMENT_APPLY, entity_type: 'payment_application', entity_id: null,
      before: null, after: { payment_id: args.payment_id, invoice_id: args.invoice_id, applied_amount: args.applied_amount },
    });
  }
}

export async function addApplication(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { payment_id: string; invoice_id: string; applied_amount: string },
) {
  await applyToInvoiceInternal(trx, ctx, { ...input, audit: true });
  return trx.selectFrom('payments').selectAll().where('id', '=', input.payment_id).executeTakeFirstOrThrow();
}

export async function removeApplication(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { payment_id: string; application_id: string },
) {
  const payment = await trx.selectFrom('payments').selectAll().where('id', '=', input.payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('payment', input.payment_id);
  const app = await trx.selectFrom('payment_applications').selectAll().where('id', '=', input.application_id).executeTakeFirst();
  if (!app || app.payment_id !== input.payment_id) throw new NotFoundError('payment_application', input.application_id);

  await trx.deleteFrom('payment_applications').where('id', '=', app.id).execute();
  await trx.updateTable('payments')
    .set({ unapplied_amount: toMoneyString(addMoney(payment.unapplied_amount, app.applied_amount)) })
    .where('id', '=', payment.id).execute();

  // Possibly un-pay the invoice
  if (app.invoice_id) await maybeUnmarkInvoicePaid(trx, ctx, app.invoice_id);

  await auditRecord(trx, ctx, {
    action: AUDIT.PAYMENT_UNAPPLY, entity_type: 'payment_application', entity_id: app.id,
    before: app, after: null,
  });
}

export async function voidPayment(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { payment_id: string; void_reason: string },
) {
  const payment = await trx.selectFrom('payments').selectAll().where('id', '=', input.payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('payment', input.payment_id);
  if (payment.status !== 'posted') throw new InvalidStateTransitionError('payment', payment.id, payment.status, 'voided');

  const apps = await trx.selectFrom('payment_applications').select('id').where('payment_id', '=', payment.id).execute();
  if (apps.length > 0) throw new PaymentHasApplicationsError(payment.id, apps.length);

  if (!payment.posted_journal_entry_id) throw new PreconditionError('Payment has no JE to reverse');
  await voidJournalEntry(trx, ctx, { journal_entry_id: payment.posted_journal_entry_id, void_reason: `Void payment: ${input.void_reason}` });

  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('payments')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', payment.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.PAYMENT_VOID, entity_type: 'payment', entity_id: payment.id, before: payment, after: updated });
  return updated;
}

async function maybeMarkInvoicePaid(trx: Transaction<DB>, _ctx: ServiceCtx, invoice_id: string) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', invoice_id).executeTakeFirst();
  if (!inv || inv.status !== 'posted') return;
  const r = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', invoice_id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('cm.status', 'in', ['posted', 'applied'])]))
    .executeTakeFirst();
  if (equalMoney(r?.applied ?? '0', inv.total)) {
    await trx.updateTable('invoices').set({ status: 'paid' }).where('id', '=', invoice_id).execute();
  }
}

async function maybeUnmarkInvoicePaid(trx: Transaction<DB>, _ctx: ServiceCtx, invoice_id: string) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', invoice_id).executeTakeFirst();
  if (!inv || inv.status !== 'paid') return;
  const r = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', invoice_id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('cm.status', 'in', ['posted', 'applied'])]))
    .executeTakeFirst();
  if (!equalMoney(r?.applied ?? '0', inv.total)) {
    await trx.updateTable('invoices').set({ status: 'posted' }).where('id', '=', invoice_id).execute();
  }
}

export async function getPaymentWithApplications(db: Kysely<DB>, business_id: string, payment_id: string) {
  const p = await db.selectFrom('payments').selectAll().where('id', '=', payment_id).where('business_id', '=', business_id).executeTakeFirst();
  if (!p) throw new NotFoundError('payment', payment_id);
  const apps = await db.selectFrom('payment_applications as pa')
    .innerJoin('invoices as i', 'i.id', 'pa.invoice_id')
    .select(['pa.id', 'pa.invoice_id', 'i.invoice_number', 'pa.applied_amount', 'pa.applied_at'])
    .where('pa.payment_id', '=', payment_id).execute();
  return { payment: p, applications: apps };
}

export async function listPayments(db: Kysely<DB>, q: { business_id: string; customer_id?: string; status?: string }) {
  let qb = db.selectFrom('payments').selectAll().where('business_id', '=', q.business_id);
  if (q.customer_id) qb = qb.where('customer_id', '=', q.customer_id);
  if (q.status) qb = qb.where('status', '=', q.status as PaymentStatus);
  return qb.orderBy('payment_date', 'desc').execute();
}
