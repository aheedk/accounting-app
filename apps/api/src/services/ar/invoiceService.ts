import { type Kysely, type Selectable, sql, type Transaction } from 'kysely';
import { AUDIT, ERR, addMoney, mulMoney, toMoneyString } from '@accounting/shared';
import type { DB, InvoiceStatus, InvoiceLinesTable, JournalEntrySourceType } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { InvoiceHasApplicationsError } from '../../lib/arErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import { getEffectiveRate } from '../tax/taxCodeService.js';
import { getSystemAccount } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type InvoiceLineInput = {
  description: string;
  quantity: string;
  unit_price: string;
  revenue_account_id: string;
  tax_code_id: string | null;
};

export type CreateDraftInput = {
  business_id: string;
  customer_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  memo: string | null;
  terms: string | null;
  lines: InvoiceLineInput[];
};

async function computeLine(
  db: Kysely<DB> | Transaction<DB>, line: InvoiceLineInput, issue_date: string,
) {
  const subtotal = toMoneyString(mulMoney(line.quantity, line.unit_price));
  let taxAmount = '0.0000';
  if (line.tax_code_id) {
    const rate = await getEffectiveRate(db as Kysely<DB>, line.tax_code_id, issue_date);
    taxAmount = toMoneyString(mulMoney(subtotal, rate));
  }
  const total = toMoneyString(addMoney(subtotal, taxAmount));
  return { subtotal, taxAmount, total };
}

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftInput) {
  if (input.lines.length === 0) throw new PreconditionError('Invoice must have at least one line');

  const dup = await trx.selectFrom('invoices').select('id')
    .where('business_id', '=', input.business_id).where('invoice_number', '=', input.invoice_number)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Invoice ${input.invoice_number} already exists`);

  const arAccount = await getSystemAccount(trx as unknown as Kysely<DB>, input.business_id, '1100');

  let subtotalSum = '0.0000';
  let taxSum = '0.0000';
  const computed: Array<{ line: InvoiceLineInput; subtotal: string; taxAmount: string; total: string }> = [];
  for (const l of input.lines) {
    const c = await computeLine(trx, l, input.issue_date);
    computed.push({ line: l, ...c });
    subtotalSum = toMoneyString(addMoney(subtotalSum, c.subtotal));
    taxSum = toMoneyString(addMoney(taxSum, c.taxAmount));
  }
  const total = toMoneyString(addMoney(subtotalSum, taxSum));

  const inv = await trx.insertInto('invoices').values({
    business_id: input.business_id,
    customer_id: input.customer_id,
    invoice_number: input.invoice_number,
    issue_date: input.issue_date,
    due_date: input.due_date,
    subtotal: subtotalSum,
    tax_total: taxSum,
    total: total,
    ar_account_id: arAccount.id,
    memo: input.memo,
    terms: input.terms,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  let n = 1;
  const lineRows: Selectable<InvoiceLinesTable>[] = [];
  for (const c of computed) {
    const row = await trx.insertInto('invoice_lines').values({
      invoice_id: inv.id, line_number: n++,
      description: c.line.description,
      quantity: c.line.quantity,
      unit_price: c.line.unit_price,
      revenue_account_id: c.line.revenue_account_id,
      tax_code_id: c.line.tax_code_id,
      line_subtotal: c.subtotal,
      tax_amount: c.taxAmount,
      line_total: c.total,
    }).returningAll().executeTakeFirstOrThrow();
    lineRows.push(row);
  }

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_CREATE, entity_type: 'invoice', entity_id: inv.id, before: null, after: inv });
  return { invoice: inv, lines: lineRows };
}

export async function postInvoice(trx: Transaction<DB>, ctx: ServiceCtx, input: { invoice_id: string }) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.status !== 'draft') throw new InvalidStateTransitionError('invoice', inv.id, inv.status, 'posted');

  const lines = await trx.selectFrom('invoice_lines').selectAll().where('invoice_id', '=', inv.id).orderBy('line_number').execute();
  if (lines.length === 0) throw new PreconditionError('Cannot post invoice with no lines');

  // Build JE lines: DR AR for total, CR revenue per distinct revenue_account_id, CR tax per distinct tax payable account.
  const jeLines: { account_id: string; debit: string; credit: string; memo: string | null }[] = [];
  jeLines.push({ account_id: inv.ar_account_id, debit: inv.total, credit: '0.0000', memo: `Invoice ${inv.invoice_number}` });

  // Aggregate revenue lines by revenue_account_id (sum line_subtotal)
  const revenueByAccount = new Map<string, string>();
  for (const l of lines) {
    const cur = revenueByAccount.get(l.revenue_account_id) ?? '0.0000';
    revenueByAccount.set(l.revenue_account_id, toMoneyString(addMoney(cur, l.line_subtotal)));
  }
  for (const [account_id, amount] of revenueByAccount) {
    if (parseFloat(amount) > 0) jeLines.push({ account_id, debit: '0.0000', credit: amount, memo: null });
  }

  // Aggregate tax lines by tax_code's payable account
  const taxByPayableAccount = new Map<string, string>();
  for (const l of lines) {
    if (!l.tax_code_id || parseFloat(l.tax_amount) === 0) continue;
    const tc = await trx.selectFrom('tax_codes').select('tax_payable_account_id').where('id', '=', l.tax_code_id).executeTakeFirstOrThrow();
    const cur = taxByPayableAccount.get(tc.tax_payable_account_id) ?? '0.0000';
    taxByPayableAccount.set(tc.tax_payable_account_id, toMoneyString(addMoney(cur, l.tax_amount)));
  }
  for (const [account_id, amount] of taxByPayableAccount) {
    if (parseFloat(amount) > 0) jeLines.push({ account_id, debit: '0.0000', credit: amount, memo: null });
  }

  if (jeLines.length < 2) throw new PreconditionError('Invoice JE would be invalid (single-line)');

  const je = await postJournalEntry(trx, ctx, {
    business_id: inv.business_id,
    entry_date: inv.issue_date,
    source_type: 'invoice' satisfies JournalEntrySourceType,
    source_id: inv.id,
    memo: `Invoice ${inv.invoice_number}`,
    reference: inv.invoice_number,
    lines: jeLines,
  });

  const updated = await trx.updateTable('invoices')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', inv.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_POST, entity_type: 'invoice', entity_id: inv.id, before: inv, after: updated });
  return updated;
}

export async function voidInvoice(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { invoice_id: string; void_reason: string },
) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.status !== 'posted' && inv.status !== 'paid') throw new InvalidStateTransitionError('invoice', inv.id, inv.status, 'voided');

  // Refuse if any payment_applications target this invoice with a posted/draft (live) source
  const apps = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(['pa.id'])
    .where('pa.invoice_id', '=', inv.id)
    .where(eb => eb.or([
      eb('p.status', 'in', ['draft', 'posted']),
      eb('cm.status', 'in', ['draft', 'posted', 'applied']),
    ]))
    .execute();
  if (apps.length > 0) throw new InvoiceHasApplicationsError(inv.id, apps.length);

  if (!inv.posted_journal_entry_id) throw new PreconditionError('Invoice has no posted JE to reverse');
  await voidJournalEntry(trx, ctx, { journal_entry_id: inv.posted_journal_entry_id, void_reason: `Void invoice ${inv.invoice_number}: ${input.void_reason}` });

  // Now flip invoice status (allow_void was set inside voidJournalEntry's wrapper if needed; we set it explicitly here)
  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('invoices')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', inv.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_VOID, entity_type: 'invoice', entity_id: inv.id, before: inv, after: updated });
  return updated;
}

export async function getInvoiceWithLines(db: Kysely<DB>, business_id: string, invoice_id: string) {
  const inv = await db.selectFrom('invoices').selectAll()
    .where('id', '=', invoice_id).where('business_id', '=', business_id)
    .executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', invoice_id);
  const lines = await db.selectFrom('invoice_lines').selectAll()
    .where('invoice_id', '=', invoice_id).orderBy('line_number').execute();

  // Compute amount_due
  const apps = await db.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', invoice_id)
    .where(eb => eb.or([
      eb('p.status', '=', 'posted'),
      eb('cm.status', 'in', ['posted', 'applied']),
    ]))
    .executeTakeFirst();
  const applied = apps?.applied ?? '0';
  const amount_due = toMoneyString(addMoney(inv.total, '0').minus(applied));
  return { invoice: inv, lines, amount_due };
}

export async function listInvoices(db: Kysely<DB>, q: { business_id: string; status?: string; customer_id?: string; limit?: number; offset?: number }) {
  let qb = db.selectFrom('invoices').selectAll().where('business_id', '=', q.business_id).where('deleted_at', 'is', null);
  if (q.status) qb = qb.where('status', '=', q.status as InvoiceStatus);
  if (q.customer_id) qb = qb.where('customer_id', '=', q.customer_id);
  return qb.orderBy('issue_date', 'desc').limit(q.limit ?? 50).offset(q.offset ?? 0).execute();
}

async function recomputeInvoiceTotals(trx: Transaction<DB>, invoice_id: string) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', invoice_id).executeTakeFirstOrThrow();
  const lines = await trx.selectFrom('invoice_lines').selectAll().where('invoice_id', '=', invoice_id).execute();
  let sub = '0.0000', tax = '0.0000';
  for (const l of lines) { sub = toMoneyString(addMoney(sub, l.line_subtotal)); tax = toMoneyString(addMoney(tax, l.tax_amount)); }
  const total = toMoneyString(addMoney(sub, tax));
  await trx.updateTable('invoices').set({ subtotal: sub, tax_total: tax, total }).where('id', '=', invoice_id).execute();
  void inv;
}

export async function addLine(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { invoice_id: string; line: InvoiceLineInput },
) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.status !== 'draft') throw new InvalidStateTransitionError('invoice', inv.id, inv.status, 'mutate');

  const c = await computeLine(trx as unknown as Kysely<DB>, input.line, inv.issue_date);
  const last = await trx.selectFrom('invoice_lines').select(({ fn }) => fn.max<number>('line_number').as('mx'))
    .where('invoice_id', '=', input.invoice_id).executeTakeFirst();
  const next = (last?.mx ?? 0) + 1;
  await trx.insertInto('invoice_lines').values({
    invoice_id: input.invoice_id, line_number: next,
    description: input.line.description, quantity: input.line.quantity, unit_price: input.line.unit_price,
    revenue_account_id: input.line.revenue_account_id, tax_code_id: input.line.tax_code_id,
    line_subtotal: c.subtotal, tax_amount: c.taxAmount, line_total: c.total,
  }).execute();
  await recomputeInvoiceTotals(trx, input.invoice_id);

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_ADD_LINE, entity_type: 'invoice', entity_id: input.invoice_id, before: null, after: input.line });
  return getInvoiceWithLines(trx as unknown as Kysely<DB>, inv.business_id, input.invoice_id);
}

export async function removeLine(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { invoice_id: string; line_id: string },
) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.status !== 'draft') throw new InvalidStateTransitionError('invoice', inv.id, inv.status, 'mutate');

  await trx.deleteFrom('invoice_lines').where('id', '=', input.line_id).where('invoice_id', '=', input.invoice_id).execute();
  await recomputeInvoiceTotals(trx, input.invoice_id);

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_REMOVE_LINE, entity_type: 'invoice', entity_id: input.invoice_id, before: { line_id: input.line_id }, after: null });
  return getInvoiceWithLines(trx as unknown as Kysely<DB>, inv.business_id, input.invoice_id);
}
