import { type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateLabelInput = {
  business_id: string;
  invoice_id?: string | null;
  sales_order_id?: string | null;
  carrier: string;
  tracking_number: string;
  shipped_at: string;
  cost?: string | null;
  label_file_id?: string | null;
  notes?: string | null;
};

export async function createLabel(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateLabelInput) {
  if (!input.invoice_id && !input.sales_order_id) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'invoice_id or sales_order_id required');
  }
  const values: {
    business_id: string;
    invoice_id: string | null;
    sales_order_id: string | null;
    carrier: string;
    tracking_number: string;
    shipped_at: string;
    cost: string | null;
    label_file_id: string | null;
    notes: string | null;
    created_by_user_id: string;
  } = {
    business_id: input.business_id,
    invoice_id: input.invoice_id ?? null,
    sales_order_id: input.sales_order_id ?? null,
    carrier: input.carrier,
    tracking_number: input.tracking_number,
    shipped_at: input.shipped_at,
    cost: input.cost ?? null,
    label_file_id: input.label_file_id ?? null,
    notes: input.notes ?? null,
    created_by_user_id: ctx.user_id,
  };
  const row = await trx.insertInto('shipping_labels').values(values).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.SHIPPING_LABEL_CREATE,
    entity_type: 'shipping_label', entity_id: row.id,
    before: null, after: row,
  });
  return row;
}

export async function deleteLabel(trx: Transaction<DB>, ctx: ServiceCtx, input: { label_id: string }) {
  const before = await trx.selectFrom('shipping_labels').selectAll()
    .where('id', '=', input.label_id).executeTakeFirst();
  if (!before) throw new NotFoundError('shipping_label', input.label_id);
  await trx.deleteFrom('shipping_labels').where('id', '=', input.label_id).execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.SHIPPING_LABEL_DELETE,
    entity_type: 'shipping_label', entity_id: input.label_id,
    before, after: null,
  });
}

export async function listLabels(db: Kysely<DB>, business_id: string, opts: { invoice_id?: string; sales_order_id?: string } = {}) {
  let q = db.selectFrom('shipping_labels').selectAll().where('business_id', '=', business_id);
  if (opts.invoice_id) q = q.where('invoice_id', '=', opts.invoice_id);
  if (opts.sales_order_id) q = q.where('sales_order_id', '=', opts.sales_order_id);
  return q.orderBy('shipped_at', 'desc').execute();
}
