import { type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, PurchaseOrderStatus } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { nextCounter } from '../core/numberingService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreatePOLineInput = {
  inventory_item_id: string;
  description?: string | null;
  quantity: string;
  unit_cost: string;
};

export type CreatePOInput = {
  business_id: string;
  vendor_id: string;
  order_date: string;
  expected_delivery_date?: string | null;
  memo?: string | null;
  lines: CreatePOLineInput[];
};

async function nextPONumber(trx: Transaction<DB>, business_id: string): Promise<string> {
  const n = await nextCounter(trx, business_id, 'purchase_order');
  return `PO-${String(n).padStart(4, '0')}`;
}

export async function createPO(trx: Transaction<DB>, ctx: ServiceCtx, input: CreatePOInput) {
  if (input.lines.length === 0) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'PO must have at least one line');
  }
  const po_number = await nextPONumber(trx, input.business_id);
  const po = await trx.insertInto('purchase_orders').values({
    business_id: input.business_id,
    po_number,
    vendor_id: input.vendor_id,
    order_date: input.order_date,
    expected_delivery_date: input.expected_delivery_date ?? null,
    memo: input.memo ?? null,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('purchase_order_lines').values(
    input.lines.map((l, i) => ({
      purchase_order_id: po.id,
      line_number: i + 1,
      inventory_item_id: l.inventory_item_id,
      description: l.description ?? null,
      quantity: l.quantity,
      unit_cost: l.unit_cost,
    })),
  ).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.PURCHASE_ORDER_CREATE,
    entity_type: 'purchase_order',
    entity_id: po.id,
    before: null,
    after: po,
  });
  return po;
}

export async function voidPO(trx: Transaction<DB>, ctx: ServiceCtx, input: { po_id: string }) {
  const before = await trx.selectFrom('purchase_orders').selectAll()
    .where('id', '=', input.po_id).executeTakeFirst();
  if (!before) throw new NotFoundError('purchase_order', input.po_id);

  const receipts = await trx.selectFrom('item_receipts').select('id')
    .where('purchase_order_id', '=', input.po_id).execute();
  if (receipts.length > 0) {
    throw new BusinessRuleError(
      ERR.PRECONDITION_FAILED,
      `PO has ${receipts.length} item receipt(s); cannot void`,
    );
  }

  const updated = await trx.updateTable('purchase_orders').set({ status: 'void' })
    .where('id', '=', input.po_id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.PURCHASE_ORDER_VOID,
    entity_type: 'purchase_order',
    entity_id: updated.id,
    before,
    after: updated,
  });
  return updated;
}

export async function listPOs(
  db: Kysely<DB>,
  business_id: string,
  opts: { status?: PurchaseOrderStatus } = {},
) {
  let q = db.selectFrom('purchase_orders').selectAll().where('business_id', '=', business_id);
  if (opts.status) q = q.where('status', '=', opts.status);
  return q.orderBy('order_date', 'desc').execute();
}

export async function getPO(db: Kysely<DB>, business_id: string, id: string) {
  const po = await db.selectFrom('purchase_orders').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!po) throw new NotFoundError('purchase_order', id);
  const lines = await db.selectFrom('purchase_order_lines').selectAll()
    .where('purchase_order_id', '=', id).orderBy('line_number').execute();
  return { ...po, lines };
}
