import { type Selectable, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, StockMovementReason, StockMovementsTable } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type StockMovement = Selectable<StockMovementsTable>;

export type AdjustStockInput = {
  business_id: string;
  item_id: string;
  movement_date: string;
  quantity_delta: string;
  reason: StockMovementReason;
  memo: string | null;
};

export async function adjustStock(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: AdjustStockInput,
): Promise<StockMovement> {
  const item = await trx.selectFrom('inventory_items')
    .select(['id', 'business_id', 'is_active', 'deleted_at'])
    .where('id', '=', input.item_id)
    .executeTakeFirst();
  if (!item || item.deleted_at) throw new NotFoundError('inventory_item', input.item_id);
  if (item.business_id !== input.business_id) {
    throw new PreconditionError('inventory_item does not belong to business', {
      item_id: input.item_id,
    });
  }
  if (!item.is_active) {
    throw new PreconditionError('inventory_item is inactive', { item_id: input.item_id });
  }

  if (parseFloat(input.quantity_delta) === 0) {
    throw new PreconditionError('quantity_delta must be non-zero');
  }

  const row = await trx.insertInto('stock_movements').values({
    inventory_item_id: input.item_id,
    movement_date: input.movement_date,
    quantity_delta: input.quantity_delta,
    reason: input.reason,
    memo: input.memo,
    posted_by_user_id: ctx.user_id === '00000000-0000-0000-0000-000000000000' ? null : ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.STOCK_MOVEMENT_CREATE,
    entity_type: 'stock_movement',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}
