import { type Kysely, type Selectable, sql, type Transaction } from 'kysely';
import { AUDIT, ERR, addMoney, mulMoney, toMoneyString } from '@accounting/shared';
import type { DB, BillStatus, BillLinesTable, JournalEntrySourceType } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { BillHasApplicationsError } from '../../lib/apErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import { getSystemAccount } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type BillLineInput = {
  description: string;
  quantity: string;
  unit_price: string;
  expense_account_id: string;
};

export type CreateDraftBillInput = {
  business_id: string;
  vendor_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string;
  memo: string | null;
  terms: string | null;
  lines: BillLineInput[];
};

function computeLine(line: BillLineInput) {
  const subtotal = toMoneyString(mulMoney(line.quantity, line.unit_price));
  return { subtotal };
}

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftBillInput) {
  if (input.lines.length === 0) throw new PreconditionError('Bill must have at least one line');

  const dup = await trx.selectFrom('bills').select('id')
    .where('business_id', '=', input.business_id).where('bill_number', '=', input.bill_number)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Bill ${input.bill_number} already exists`);

  const apAccount = await getSystemAccount(trx as unknown as Kysely<DB>, input.business_id, '2010');

  let subtotalSum = '0.0000';
  const computed: Array<{ line: BillLineInput; subtotal: string }> = [];
  for (const l of input.lines) {
    const c = computeLine(l);
    computed.push({ line: l, ...c });
    subtotalSum = toMoneyString(addMoney(subtotalSum, c.subtotal));
  }
  const total = subtotalSum;

  const bill = await trx.insertInto('bills').values({
    business_id: input.business_id,
    vendor_id: input.vendor_id,
    bill_number: input.bill_number,
    bill_date: input.bill_date,
    due_date: input.due_date,
    subtotal: subtotalSum,
    total: total,
    ap_account_id: apAccount.id,
    memo: input.memo,
    terms: input.terms,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  let n = 1;
  const lineRows: Selectable<BillLinesTable>[] = [];
  for (const c of computed) {
    const row = await trx.insertInto('bill_lines').values({
      bill_id: bill.id, line_number: n++,
      description: c.line.description,
      quantity: c.line.quantity,
      unit_price: c.line.unit_price,
      expense_account_id: c.line.expense_account_id,
      line_subtotal: c.subtotal,
    }).returningAll().executeTakeFirstOrThrow();
    lineRows.push(row);
  }

  await auditRecord(trx, ctx, { action: AUDIT.BILL_CREATE, entity_type: 'bill', entity_id: bill.id, before: null, after: bill });
  return { bill, lines: lineRows };
}

export async function postBill(trx: Transaction<DB>, ctx: ServiceCtx, input: { bill_id: string }) {
  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', input.bill_id).executeTakeFirst();
  if (!bill) throw new NotFoundError('bill', input.bill_id);
  if (bill.status !== 'draft') throw new InvalidStateTransitionError('bill', bill.id, bill.status, 'posted');

  const lines = await trx.selectFrom('bill_lines').selectAll().where('bill_id', '=', bill.id).orderBy('line_number').execute();
  if (lines.length === 0) throw new PreconditionError('Cannot post bill with no lines');

  // Build JE lines: DR expense per distinct expense_account_id (sum of line_subtotals), CR AP for total
  const jeLines: { account_id: string; debit: string; credit: string; memo: string | null }[] = [];

  const expenseByAccount = new Map<string, string>();
  for (const l of lines) {
    const cur = expenseByAccount.get(l.expense_account_id) ?? '0.0000';
    expenseByAccount.set(l.expense_account_id, toMoneyString(addMoney(cur, l.line_subtotal)));
  }
  for (const [account_id, amount] of expenseByAccount) {
    if (parseFloat(amount) > 0) jeLines.push({ account_id, debit: amount, credit: '0.0000', memo: null });
  }

  jeLines.push({ account_id: bill.ap_account_id, debit: '0.0000', credit: bill.total, memo: `Bill ${bill.bill_number}` });

  if (jeLines.length < 2) throw new PreconditionError('Bill JE would be invalid (single-line)');

  const je = await postJournalEntry(trx, ctx, {
    business_id: bill.business_id,
    entry_date: bill.bill_date,
    source_type: 'bill' satisfies JournalEntrySourceType,
    source_id: bill.id,
    memo: `Bill ${bill.bill_number}`,
    reference: bill.bill_number,
    lines: jeLines,
  });

  const updated = await trx.updateTable('bills')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', bill.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.BILL_POST, entity_type: 'bill', entity_id: bill.id, before: bill, after: updated });
  return updated;
}

export async function voidBill(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { bill_id: string; void_reason: string },
) {
  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', input.bill_id).executeTakeFirst();
  if (!bill) throw new NotFoundError('bill', input.bill_id);
  if (bill.status !== 'posted' && bill.status !== 'paid') throw new InvalidStateTransitionError('bill', bill.id, bill.status, 'voided');

  // Refuse if any bill_payment_applications target this bill with a posted/draft (live) source
  const apps = await trx.selectFrom('bill_payment_applications as pa')
    .leftJoin('bill_payments as p', 'p.id', 'pa.bill_payment_id')
    .leftJoin('vendor_credits as vc', 'vc.id', 'pa.vendor_credit_id')
    .select(['pa.id'])
    .where('pa.bill_id', '=', bill.id)
    .where(eb => eb.or([
      eb('p.status', 'in', ['draft', 'posted']),
      eb('vc.status', 'in', ['draft', 'posted', 'applied']),
    ]))
    .execute();
  if (apps.length > 0) throw new BillHasApplicationsError(bill.id, apps.length);

  if (!bill.posted_journal_entry_id) throw new PreconditionError('Bill has no posted JE to reverse');
  await voidJournalEntry(trx, ctx, {
    journal_entry_id: bill.posted_journal_entry_id,
    void_reason: `Void bill ${bill.bill_number}: ${input.void_reason}`,
    source_guard: { source_type: 'bill', source_id: bill.id },
  });

  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('bills')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', bill.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.BILL_VOID, entity_type: 'bill', entity_id: bill.id, before: bill, after: updated });
  return updated;
}

export async function getBillWithLines(db: Kysely<DB>, business_id: string, bill_id: string) {
  const bill = await db.selectFrom('bills').selectAll()
    .where('id', '=', bill_id).where('business_id', '=', business_id)
    .executeTakeFirst();
  if (!bill) throw new NotFoundError('bill', bill_id);
  const lines = await db.selectFrom('bill_lines').selectAll()
    .where('bill_id', '=', bill_id).orderBy('line_number').execute();

  // Compute amount_due
  const apps = await db.selectFrom('bill_payment_applications as pa')
    .leftJoin('bill_payments as p', 'p.id', 'pa.bill_payment_id')
    .leftJoin('vendor_credits as vc', 'vc.id', 'pa.vendor_credit_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.bill_id', '=', bill_id)
    .where(eb => eb.or([
      eb('p.status', '=', 'posted'),
      eb('vc.status', 'in', ['posted', 'applied']),
    ]))
    .executeTakeFirst();
  const applied = apps?.applied ?? '0';
  const amount_due = toMoneyString(addMoney(bill.total, '0').minus(applied));
  return { bill, lines, amount_due };
}

export async function listBills(db: Kysely<DB>, q: { business_id: string; status?: string; vendor_id?: string; limit?: number; offset?: number }) {
  let qb = db.selectFrom('bills').selectAll().where('business_id', '=', q.business_id).where('deleted_at', 'is', null);
  if (q.status) qb = qb.where('status', '=', q.status as BillStatus);
  if (q.vendor_id) qb = qb.where('vendor_id', '=', q.vendor_id);
  return qb.orderBy('bill_date', 'desc').limit(q.limit ?? 50).offset(q.offset ?? 0).execute();
}

async function recomputeBillTotals(trx: Transaction<DB>, bill_id: string) {
  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', bill_id).executeTakeFirstOrThrow();
  const lines = await trx.selectFrom('bill_lines').selectAll().where('bill_id', '=', bill_id).execute();
  let sub = '0.0000';
  for (const l of lines) { sub = toMoneyString(addMoney(sub, l.line_subtotal)); }
  await trx.updateTable('bills').set({ subtotal: sub, total: sub }).where('id', '=', bill_id).execute();
  void bill;
}

export async function addLine(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { bill_id: string; line: BillLineInput },
) {
  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', input.bill_id).executeTakeFirst();
  if (!bill) throw new NotFoundError('bill', input.bill_id);
  if (bill.status !== 'draft') throw new InvalidStateTransitionError('bill', bill.id, bill.status, 'mutate');

  const c = computeLine(input.line);
  const last = await trx.selectFrom('bill_lines').select(({ fn }) => fn.max<number>('line_number').as('mx'))
    .where('bill_id', '=', input.bill_id).executeTakeFirst();
  const next = (last?.mx ?? 0) + 1;
  await trx.insertInto('bill_lines').values({
    bill_id: input.bill_id, line_number: next,
    description: input.line.description, quantity: input.line.quantity, unit_price: input.line.unit_price,
    expense_account_id: input.line.expense_account_id,
    line_subtotal: c.subtotal,
  }).execute();
  await recomputeBillTotals(trx, input.bill_id);

  await auditRecord(trx, ctx, { action: AUDIT.BILL_ADD_LINE, entity_type: 'bill', entity_id: input.bill_id, before: null, after: input.line });
  return getBillWithLines(trx as unknown as Kysely<DB>, bill.business_id, input.bill_id);
}

export async function removeLine(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { bill_id: string; line_id: string },
) {
  const bill = await trx.selectFrom('bills').selectAll().where('id', '=', input.bill_id).executeTakeFirst();
  if (!bill) throw new NotFoundError('bill', input.bill_id);
  if (bill.status !== 'draft') throw new InvalidStateTransitionError('bill', bill.id, bill.status, 'mutate');

  await trx.deleteFrom('bill_lines').where('id', '=', input.line_id).where('bill_id', '=', input.bill_id).execute();
  await recomputeBillTotals(trx, input.bill_id);

  await auditRecord(trx, ctx, { action: AUDIT.BILL_REMOVE_LINE, entity_type: 'bill', entity_id: input.bill_id, before: { line_id: input.line_id }, after: null });
  return getBillWithLines(trx as unknown as Kysely<DB>, bill.business_id, input.bill_id);
}
