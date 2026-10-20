import { type Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, addMoney, toMoneyString } from '@accounting/shared';
import type { DB, EstimateStatus } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { nextNumber } from '../core/numberingService.js';
import { computeLine, createDraft, getNextInvoiceNumber } from './invoiceService.js';
import { scopeBusiness, type ServiceCtx } from '../../lib/ctx.js';

// A quote to a customer that becomes an invoice. Nothing here posts; the
// invoice made from an estimate is a draft an accountant posts.
// Spec: docs/specs/2026-10-20-estimates-design.md

export type EstimateLineInput = {
  inventory_item_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  revenue_account_id: string;
  tax_code_id: string | null;
};

export type SaveEstimateInput = {
  business_id: string;
  customer_id: string;
  estimate_date: string;
  expiration_date: string | null;
  memo: string | null;
  lines: EstimateLineInput[];
};

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

/** The customer, accounts, tax codes and products named must all be this company's. */
async function checkReferences(trx: Transaction<DB>, input: SaveEstimateInput) {
  if (input.lines.length === 0) throw new PreconditionError('An estimate needs at least one line');
  if (input.expiration_date && input.expiration_date < input.estimate_date) {
    throw new PreconditionError('The expiration date cannot be before the estimate date');
  }
  const customer = await trx.selectFrom('customers').select('id')
    .where('id', '=', input.customer_id).where('business_id', '=', input.business_id)
    .where('deleted_at', 'is', null).executeTakeFirst();
  if (!customer) throw new NotFoundError('customer', input.customer_id);

  const unique = (ids: Array<string | null>) => [...new Set(ids.filter((id): id is string => !!id))];
  const accountIds = unique(input.lines.map(l => l.revenue_account_id));
  const accounts = await trx.selectFrom('chart_of_accounts').select('id')
    .where('business_id', '=', input.business_id).where('id', 'in', accountIds).execute();
  if (accounts.length !== accountIds.length) throw new NotFoundError('account');

  const taxIds = unique(input.lines.map(l => l.tax_code_id));
  if (taxIds.length > 0) {
    const taxCodes = await trx.selectFrom('tax_codes').select('id')
      .where('business_id', '=', input.business_id).where('id', 'in', taxIds).execute();
    if (taxCodes.length !== taxIds.length) throw new NotFoundError('tax_code');
  }

  const itemIds = unique(input.lines.map(l => l.inventory_item_id));
  if (itemIds.length > 0) {
    const items = await trx.selectFrom('inventory_items').select('id')
      .where('business_id', '=', input.business_id).where('id', 'in', itemIds).execute();
    if (items.length !== itemIds.length) throw new NotFoundError('inventory_item');
  }
}

/** Each line priced with the invoice's own rule, and the estimate's totals. */
async function priceLines(trx: Transaction<DB>, input: SaveEstimateInput) {
  let subtotal = '0.0000';
  let tax_total = '0.0000';
  const lines = [];
  for (const [i, l] of input.lines.entries()) {
    const c = await computeLine(trx, l, input.estimate_date);
    subtotal = toMoneyString(addMoney(subtotal, c.subtotal));
    tax_total = toMoneyString(addMoney(tax_total, c.taxAmount));
    lines.push({
      line_number: i + 1,
      inventory_item_id: l.inventory_item_id,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      revenue_account_id: l.revenue_account_id,
      tax_code_id: l.tax_code_id,
      line_subtotal: c.subtotal,
      tax_amount: c.taxAmount,
      line_total: c.total,
    });
  }
  return { lines, subtotal, tax_total, total: toMoneyString(addMoney(subtotal, tax_total)) };
}

/** The estimate for a change, locked; refused once it is an invoice. */
async function openEstimate(trx: Transaction<DB>, ctx: ServiceCtx, estimate_id: string, doing: string) {
  const estimate = await trx.selectFrom('estimates').selectAll()
    .where('id', '=', estimate_id).where('business_id', '=', scopeBusiness(ctx))
    .forUpdate().executeTakeFirst();
  if (!estimate) throw new NotFoundError('estimate', estimate_id);
  if (estimate.status === 'closed') {
    throw new PreconditionError(`Estimate ${estimate.estimate_number} is closed: it is already an invoice, so it cannot be ${doing}`);
  }
  return estimate;
}

export async function createEstimate(trx: Transaction<DB>, ctx: ServiceCtx, input: SaveEstimateInput) {
  await checkReferences(trx, input);
  const priced = await priceLines(trx, input);
  const estimate = await trx.insertInto('estimates').values({
    business_id: input.business_id,
    estimate_number: await nextNumber(trx, input.business_id, 'estimate', 'EST'),
    customer_id: input.customer_id,
    estimate_date: input.estimate_date,
    expiration_date: input.expiration_date,
    memo: input.memo,
    subtotal: priced.subtotal,
    tax_total: priced.tax_total,
    total: priced.total,
    created_by_user_id: ctx.user_id === SYSTEM_USER ? null : ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();
  const lines = await trx.insertInto('estimate_lines')
    .values(priced.lines.map(l => ({ ...l, estimate_id: estimate.id })))
    .returningAll().execute();

  await auditRecord(trx, ctx, { action: AUDIT.ESTIMATE_CREATE, entity_type: 'estimate', entity_id: estimate.id, before: null, after: { ...estimate, lines } });
  return { estimate, lines };
}

/** An edit is the whole estimate again: header and lines. Its number and status stay. */
export async function updateEstimate(
  trx: Transaction<DB>, ctx: ServiceCtx, input: SaveEstimateInput & { estimate_id: string },
) {
  const before = await openEstimate(trx, ctx, input.estimate_id, 'changed');
  await checkReferences(trx, input);
  const beforeLines = await trx.selectFrom('estimate_lines').selectAll()
    .where('estimate_id', '=', before.id).orderBy('line_number').execute();
  const priced = await priceLines(trx, input);

  const estimate = await trx.updateTable('estimates').set({
    customer_id: input.customer_id,
    estimate_date: input.estimate_date,
    expiration_date: input.expiration_date,
    memo: input.memo,
    subtotal: priced.subtotal,
    tax_total: priced.tax_total,
    total: priced.total,
  }).where('id', '=', before.id).returningAll().executeTakeFirstOrThrow();
  await trx.deleteFrom('estimate_lines').where('estimate_id', '=', before.id).execute();
  const lines = await trx.insertInto('estimate_lines')
    .values(priced.lines.map(l => ({ ...l, estimate_id: before.id })))
    .returningAll().execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.ESTIMATE_UPDATE, entity_type: 'estimate', entity_id: before.id,
    before: { ...before, lines: beforeLines }, after: { ...estimate, lines },
  });
  return { estimate, lines };
}

/** Pending, Accepted (with who accepted it and when) or Rejected. Closed comes only from making the invoice. */
export async function setEstimateStatus(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { estimate_id: string; status: Exclude<EstimateStatus, 'closed'>; accepted_by?: string | null; accepted_date?: string | null },
) {
  const before = await openEstimate(trx, ctx, input.estimate_id, 'marked');
  const accepted = input.status === 'accepted';
  const estimate = await trx.updateTable('estimates').set({
    status: input.status,
    accepted_by: accepted ? (input.accepted_by?.trim() || null) : null,
    accepted_date: accepted ? (input.accepted_date ?? sql<string>`current_date`) : null,
  }).where('id', '=', before.id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.ESTIMATE_STATUS, entity_type: 'estimate', entity_id: before.id, before, after: estimate });
  return estimate;
}

/**
 * Makes the estimate into a draft invoice and closes it, in one transaction.
 * The invoice takes the company's next invoice number, the customer's terms and
 * the estimate's lines and message; posting it is an accountant's step.
 */
export async function convertToInvoice(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { estimate_id: string; issue_date?: string },
) {
  const before = await openEstimate(trx, ctx, input.estimate_id, 'invoiced again');
  if (before.status === 'rejected') {
    throw new PreconditionError(`Estimate ${before.estimate_number} was rejected. Mark it pending or accepted before making the invoice.`);
  }
  const lines = await trx.selectFrom('estimate_lines').selectAll()
    .where('estimate_id', '=', before.id).orderBy('line_number').execute();
  const customer = await trx.selectFrom('customers').select('default_terms_days')
    .where('id', '=', before.customer_id).where('business_id', '=', before.business_id)
    .executeTakeFirstOrThrow();

  const issue_date = input.issue_date ?? new Date().toISOString().slice(0, 10);
  const days = Number(customer.default_terms_days) || 0;
  const due = new Date(`${issue_date}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + days);

  const { invoice } = await createDraft(trx, ctx, {
    business_id: before.business_id,
    customer_id: before.customer_id,
    invoice_number: await getNextInvoiceNumber(trx, before.business_id),
    issue_date,
    due_date: due.toISOString().slice(0, 10),
    memo: before.memo,
    terms: days === 0 ? 'Due on receipt' : `Net ${days}`,
    lines: lines.map(l => ({
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      revenue_account_id: l.revenue_account_id,
      tax_code_id: l.tax_code_id,
    })),
  });

  const estimate = await trx.updateTable('estimates')
    .set({ status: 'closed', invoice_id: invoice.id, closed_at: sql`now()` })
    .where('id', '=', before.id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.ESTIMATE_CONVERT, entity_type: 'estimate', entity_id: before.id, before, after: estimate });
  return { estimate, invoice };
}

/** Only before it is an invoice: a closed estimate's invoice points back at it. */
export async function deleteEstimate(trx: Transaction<DB>, ctx: ServiceCtx, input: { estimate_id: string }) {
  const before = await openEstimate(trx, ctx, input.estimate_id, 'deleted');
  const lines = await trx.selectFrom('estimate_lines').selectAll()
    .where('estimate_id', '=', before.id).orderBy('line_number').execute();
  await trx.deleteFrom('estimates').where('id', '=', before.id).execute();
  await auditRecord(trx, ctx, { action: AUDIT.ESTIMATE_DELETE, entity_type: 'estimate', entity_id: before.id, before: { ...before, lines }, after: null });
}

export async function listEstimates(
  db: Kysely<DB>, q: { business_id: string; status?: EstimateStatus; customer_id?: string },
) {
  let qb = db.selectFrom('estimates as e')
    .innerJoin('customers as c', 'c.id', 'e.customer_id')
    .leftJoin('invoices as i', 'i.id', 'e.invoice_id')
    .selectAll('e')
    .select(['c.name as customer_name', 'i.invoice_number'])
    .where('e.business_id', '=', q.business_id);
  if (q.status) qb = qb.where('e.status', '=', q.status);
  if (q.customer_id) qb = qb.where('e.customer_id', '=', q.customer_id);
  return qb.orderBy('e.estimate_date', 'desc').orderBy('e.estimate_number', 'desc').execute();
}

export async function getEstimate(db: Kysely<DB>, business_id: string, estimate_id: string) {
  const estimate = await db.selectFrom('estimates as e')
    .innerJoin('customers as c', 'c.id', 'e.customer_id')
    .leftJoin('invoices as i', 'i.id', 'e.invoice_id')
    .selectAll('e')
    .select(['c.name as customer_name', 'i.invoice_number'])
    .where('e.id', '=', estimate_id).where('e.business_id', '=', business_id)
    .executeTakeFirst();
  if (!estimate) throw new NotFoundError('estimate', estimate_id);
  const lines = await db.selectFrom('estimate_lines').selectAll()
    .where('estimate_id', '=', estimate_id).orderBy('line_number').execute();
  const { invoice_number, ...rest } = estimate;
  return { estimate: rest, lines, invoice_number };
}

/** The estimate an invoice was made from, for the invoice's page. */
export async function estimateForInvoice(db: Kysely<DB>, business_id: string, invoice_id: string) {
  return (await db.selectFrom('estimates').select(['id', 'estimate_number'])
    .where('business_id', '=', business_id).where('invoice_id', '=', invoice_id)
    .executeTakeFirst()) ?? null;
}
