import { type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, SalesOrderStatus } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import * as invSvc from '../ar/invoiceService.js';
import { adjustStock } from '../inventory/stockMovementService.js';
import { nextNumber } from '../core/numberingService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateSOLineInput = {
  inventory_item_id: string;
  description?: string | null;
  quantity: string;
  unit_price: string;
};

export type CreateSOInput = {
  business_id: string;
  customer_id: string;
  order_date: string;
  memo?: string | null;
  lines: CreateSOLineInput[];
};

async function nextSONumber(trx: Transaction<DB>, business_id: string): Promise<string> {
  return nextNumber(trx, business_id, 'sales_order', 'SO');
}

async function nextInvoiceNumber(trx: Transaction<DB>, business_id: string): Promise<string> {
  return nextNumber(trx, business_id, 'invoice', 'INV');
}

export async function createSO(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateSOInput) {
  if (input.lines.length === 0) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'SO must have at least one line');
  }
  const so_number = await nextSONumber(trx, input.business_id);
  const so = await trx.insertInto('sales_orders').values({
    business_id: input.business_id,
    so_number,
    customer_id: input.customer_id,
    order_date: input.order_date,
    memo: input.memo ?? null,
    created_by_user_id:
      ctx.user_id === '00000000-0000-0000-0000-000000000000' ? null : ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('sales_order_lines').values(
    input.lines.map((l, i) => ({
      sales_order_id: so.id,
      line_number: i + 1,
      inventory_item_id: l.inventory_item_id,
      description: l.description ?? null,
      quantity: l.quantity,
      unit_price: l.unit_price,
    })),
  ).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.SALES_ORDER_CREATE,
    entity_type: 'sales_order',
    entity_id: so.id,
    before: null,
    after: so,
  });
  return so;
}

export async function fulfill(trx: Transaction<DB>, ctx: ServiceCtx, input: { so_id: string }) {
  const before = await trx.selectFrom('sales_orders').selectAll()
    .where('id', '=', input.so_id).executeTakeFirst();
  if (!before) throw new NotFoundError('sales_order', input.so_id);
  if (before.status === 'void') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'cannot fulfill a voided SO');
  }
  if (before.status === 'fulfilled') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'SO already fulfilled');
  }

  const lines = await trx.selectFrom('sales_order_lines').selectAll()
    .where('sales_order_id', '=', input.so_id).orderBy('line_number').execute();
  if (lines.length === 0) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'SO has no lines');
  }

  const itemIds = [...new Set(lines.map(l => l.inventory_item_id))];
  const items = await trx.selectFrom('inventory_items').selectAll()
    .where('id', 'in', itemIds)
    .where('business_id', '=', before.business_id)
    .execute();
  const itemMap = new Map(items.map(i => [i.id, i]));

  for (const line of lines) {
    const item = itemMap.get(line.inventory_item_id);
    if (!item) throw new NotFoundError('inventory_item', line.inventory_item_id);
    if (!item.income_account_id) {
      throw new BusinessRuleError(
        ERR.PRECONDITION_FAILED,
        `item ${item.sku} has no income_account_id`,
      );
    }
  }

  // Create + post the Invoice
  const invoice_number = await nextInvoiceNumber(trx, before.business_id);
  const today = new Date().toISOString().slice(0, 10);
  const draft = await invSvc.createDraft(trx, ctx, {
    business_id: before.business_id,
    customer_id: before.customer_id,
    invoice_number,
    issue_date: today,
    due_date: today,
    memo: `Fulfillment of ${before.so_number}`,
    terms: null,
    lines: lines.map(l => {
      const item = itemMap.get(l.inventory_item_id)!;
      return {
        description: item.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        revenue_account_id: item.income_account_id!,
        tax_code_id: null,
      };
    }),
  });
  // invoiceService.createDraft returns { invoice, lines }, not the invoice directly.
  const posted = await invSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id });

  // Decrement stock per line via manual_out movements
  for (const line of lines) {
    await adjustStock(trx, ctx, {
      business_id: before.business_id,
      item_id: line.inventory_item_id,
      movement_date: today,
      quantity_delta: `-${line.quantity}`,
      reason: 'manual_out',
      memo: `Fulfillment of ${before.so_number}`,
    });
  }

  const updated = await trx.updateTable('sales_orders').set({
    status: 'fulfilled',
    invoice_id: posted.id,
  }).where('id', '=', input.so_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.SALES_ORDER_FULFILL,
    entity_type: 'sales_order',
    entity_id: updated.id,
    before,
    after: updated,
  });
  return updated;
}

export async function voidSO(trx: Transaction<DB>, ctx: ServiceCtx, input: { so_id: string }) {
  const before = await trx.selectFrom('sales_orders').selectAll()
    .where('id', '=', input.so_id).executeTakeFirst();
  if (!before) throw new NotFoundError('sales_order', input.so_id);
  if (before.status === 'fulfilled') {
    throw new BusinessRuleError(
      ERR.PRECONDITION_FAILED,
      'cannot void a fulfilled SO; void the invoice instead',
    );
  }
  const updated = await trx.updateTable('sales_orders').set({ status: 'void' })
    .where('id', '=', input.so_id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.SALES_ORDER_VOID,
    entity_type: 'sales_order',
    entity_id: updated.id,
    before,
    after: updated,
  });
  return updated;
}

export async function listSOs(
  db: Kysely<DB>,
  business_id: string,
  opts: { status?: SalesOrderStatus } = {},
) {
  let q = db.selectFrom('sales_orders').selectAll().where('business_id', '=', business_id);
  if (opts.status) q = q.where('status', '=', opts.status);
  return q.orderBy('order_date', 'desc').execute();
}

export async function getSO(db: Kysely<DB>, business_id: string, id: string) {
  const so = await db.selectFrom('sales_orders').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!so) throw new NotFoundError('sales_order', id);
  const lines = await db.selectFrom('sales_order_lines').selectAll()
    .where('sales_order_id', '=', id).orderBy('line_number').execute();
  return { ...so, lines };
}
