import { type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import * as billSvc from '../ap/billService.js';
import { adjustStock } from './stockMovementService.js';
import { getPO } from './purchaseOrderService.js';
import { nextNumber } from '../core/numberingService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateReceiptInput = {
  business_id: string;
  purchase_order_id: string;
  receipt_date: string;
  memo?: string | null;
};

async function nextBillNumber(trx: Transaction<DB>, business_id: string): Promise<string> {
  return nextNumber(trx, business_id, 'bill', 'BILL');
}

export async function createReceipt(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreateReceiptInput,
) {
  // 1. Fetch PO + lines (lines already include inventory_item_id, quantity, unit_cost).
  // getPO accepts Kysely<DB>; Transaction<DB> extends that interface so this is safe.
  const po = await getPO(trx as unknown as Kysely<DB>, input.business_id, input.purchase_order_id);
  if (po.status === 'void') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'cannot receive against a voided PO');
  }
  if (po.status === 'closed') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'PO is already closed');
  }
  if (po.lines.length === 0) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'PO has no lines');
  }

  // 2. Look up the inventory_asset_account_id for each item.
  const itemIds = [...new Set(po.lines.map(l => l.inventory_item_id))];
  const items = await trx.selectFrom('inventory_items').selectAll()
    .where('id', 'in', itemIds)
    .where('business_id', '=', input.business_id)
    .execute();
  const itemMap = new Map(items.map(i => [i.id, i]));

  for (const line of po.lines) {
    const item = itemMap.get(line.inventory_item_id);
    if (!item) throw new NotFoundError('inventory_item', line.inventory_item_id);
    if (!item.inventory_asset_account_id) {
      throw new BusinessRuleError(
        ERR.PRECONDITION_FAILED,
        `item ${item.sku} has no inventory_asset_account_id`,
      );
    }
  }

  // 3. Create + post the Bill (DR Inventory / CR AP).
  const bill_number = await nextBillNumber(trx, input.business_id);
  const draft = await billSvc.createDraft(trx, ctx, {
    business_id: input.business_id,
    vendor_id: po.vendor_id,
    bill_number,
    bill_date: input.receipt_date,
    due_date: input.receipt_date,
    memo: input.memo ?? `Receipt for ${po.po_number}`,
    terms: null,
    lines: po.lines.map(l => {
      const item = itemMap.get(l.inventory_item_id)!;
      return {
        description: item.name,
        quantity: l.quantity,
        unit_price: l.unit_cost,
        expense_account_id: item.inventory_asset_account_id!,
      };
    }),
  });
  const posted = await billSvc.postBill(trx, ctx, { bill_id: draft.bill.id });

  // 4. Insert the item_receipt row linking PO -> Bill.
  const receipt = await trx.insertInto('item_receipts').values({
    business_id: input.business_id,
    purchase_order_id: input.purchase_order_id,
    receipt_date: input.receipt_date,
    bill_id: posted.id,
    memo: input.memo ?? null,
    created_by_user_id: ctx.user_id === '00000000-0000-0000-0000-000000000000' ? null : ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  // 5. Stock movement per line (manual_in, positive quantity).
  for (const line of po.lines) {
    await adjustStock(trx, ctx, {
      business_id: input.business_id,
      item_id: line.inventory_item_id,
      movement_date: input.receipt_date,
      quantity_delta: line.quantity,
      reason: 'manual_in',
      memo: `Item receipt for ${po.po_number}`,
    });
  }

  // 6. Update PO status to 'received'.
  await trx.updateTable('purchase_orders').set({ status: 'received' })
    .where('id', '=', input.purchase_order_id).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.ITEM_RECEIPT_CREATE,
    entity_type: 'item_receipt',
    entity_id: receipt.id,
    before: null,
    after: { ...receipt, bill_id: posted.id },
  });
  return receipt;
}

export async function listReceipts(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('item_receipts').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('receipt_date', 'desc')
    .execute();
}
