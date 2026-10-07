import { type Kysely, type Selectable, type Transaction } from 'kysely';
import { AUDIT, D, toMoneyString } from '@accounting/shared';
import type { DB, StockMovementReason, StockMovementsTable } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import { getOrCreateOpeningBalanceEquity } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

// Every change in stock goes through adjustStock, and that is where inventory
// reaches the ledger. Spec: docs/specs/2026-10-07-inventory-ledger-design.md
//
//  - Each movement is costed. Stock coming in takes the cost given (a purchase
//    order's unit cost) or the item's purchase cost; stock going out takes the
//    average cost of what is on hand.
//  - An item with an inventory asset account posts a journal entry for the
//    movement. An item without one is not kept in the ledger and posts nothing.
//  - A receipt is the exception: the bill it raised already debited Inventory,
//    so the movement is linked to that entry instead of posting a second one.

export type StockMovement = Selectable<StockMovementsTable>;

export type AdjustStockInput = {
  business_id: string;
  item_id: string;
  movement_date: string;
  quantity_delta: string;
  reason: StockMovementReason;
  memo: string | null;
  /** Cost per unit of stock coming in. Ignored for stock going out, which leaves at average cost. */
  unit_cost?: string | null;
  /** This movement is already in the ledger through this entry (a receipt's bill). */
  recorded_by_journal_entry_id?: string | null;
  /** What the movement is, for the entry's memo. Defaults from the reason. */
  purpose?: 'sale' | 'receipt';
};

const REASON_LABEL: Record<StockMovementReason, string> = {
  adjustment: 'Inventory adjustment',
  opening_balance: 'Opening inventory',
  manual_in: 'Stock added',
  manual_out: 'Stock removed',
  write_off: 'Inventory write-off',
};

/** Quantity and value of an item's stock, from every movement so far. */
async function stockPosition(db: Kysely<DB> | Transaction<DB>, item_id: string) {
  const row = await db.selectFrom('stock_movements')
    .select(({ fn }) => [
      fn.sum<string>('quantity_delta').as('quantity'),
      fn.sum<string>('total_cost').as('value'),
    ])
    .where('inventory_item_id', '=', item_id)
    .executeTakeFirst();
  return { quantity: D(row?.quantity ?? '0'), value: D(row?.value ?? '0') };
}

export async function adjustStock(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: AdjustStockInput,
): Promise<StockMovement> {
  const item = await trx.selectFrom('inventory_items')
    .select([
      'id', 'business_id', 'is_active', 'deleted_at', 'name', 'sku',
      'purchase_cost', 'inventory_asset_account_id', 'expense_account_id',
    ])
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

  const delta = D(input.quantity_delta);
  if (delta.isZero()) {
    throw new PreconditionError('quantity_delta must be non-zero');
  }

  // --- What the movement cost ------------------------------------------------
  const before = await stockPosition(trx, item.id);
  const averageCost = before.quantity.gt(0) && before.value.gt(0)
    ? before.value.div(before.quantity)
    : D(item.purchase_cost ?? '0');
  let unitCost;
  let totalCost;
  if (delta.gt(0)) {
    unitCost = input.unit_cost != null && input.unit_cost !== '' ? D(input.unit_cost) : averageCost;
    if (unitCost.lt(0)) throw new PreconditionError('unit_cost cannot be negative');
    totalCost = delta.mul(unitCost).toDecimalPlaces(4);
  } else {
    unitCost = averageCost;
    // Taking the last of the stock takes all of its value, so no cents are left behind.
    const emptiesStock = before.quantity.gt(0) && before.quantity.plus(delta).isZero();
    totalCost = emptiesStock ? before.value.neg() : delta.mul(unitCost).toDecimalPlaces(4);
  }

  const row = await trx.insertInto('stock_movements').values({
    inventory_item_id: input.item_id,
    movement_date: input.movement_date,
    quantity_delta: input.quantity_delta,
    reason: input.reason,
    memo: input.memo,
    unit_cost: unitCost.toDecimalPlaces(4).toFixed(4),
    total_cost: totalCost.toFixed(4),
    journal_entry_id: input.recorded_by_journal_entry_id ?? null,
    posted_by_user_id: ctx.user_id === '00000000-0000-0000-0000-000000000000' ? null : ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  // --- Into the ledger -------------------------------------------------------
  let posted = row;
  const amount = totalCost.abs();
  const tracked = item.inventory_asset_account_id !== null;
  if (tracked && !input.recorded_by_journal_entry_id && !amount.isZero()) {
    const offsetAccountId = input.reason === 'opening_balance'
      ? (await getOrCreateOpeningBalanceEquity(trx, ctx, input.business_id)).id
      : item.expense_account_id;
    if (!offsetAccountId) {
      throw new PreconditionError(
        `${item.name} has no expense (cost of goods sold) account. Set one on the item before its stock is sold or adjusted.`,
        { item_id: item.id },
      );
    }
    const label = input.purpose === 'sale' ? 'Cost of goods sold' : REASON_LABEL[input.reason];
    const memo = `${label}: ${item.name}${input.memo ? ` (${input.memo})` : ''}`;
    const value = toMoneyString(amount);
    const stockIn = delta.gt(0);
    const entry = await postJournalEntry(trx, ctx, {
      business_id: input.business_id,
      entry_date: input.movement_date,
      // Not a hand-written entry: it belongs to this movement and is changed by another movement.
      source_type: 'adjustment',
      source_id: row.id,
      memo,
      lines: [
        { account_id: item.inventory_asset_account_id!, debit: stockIn ? value : '0.0000', credit: stockIn ? '0.0000' : value, memo },
        { account_id: offsetAccountId, debit: stockIn ? '0.0000' : value, credit: stockIn ? value : '0.0000', memo },
      ],
    });
    posted = await trx.updateTable('stock_movements').set({ journal_entry_id: entry.id })
      .where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.STOCK_MOVEMENT_CREATE,
    entity_type: 'stock_movement',
    entity_id: row.id,
    before: null,
    after: posted,
  });
  return posted;
}

/** Stock of ledger-tracked items that was recorded before inventory posted to the ledger. */
export async function unpostedStockValue(db: Kysely<DB> | Transaction<DB>, business_id: string): Promise<string> {
  const row = await db.selectFrom('stock_movements as sm')
    .innerJoin('inventory_items as i', 'i.id', 'sm.inventory_item_id')
    .select(({ fn }) => fn.sum<string>('sm.total_cost').as('value'))
    .where('i.business_id', '=', business_id)
    .where('i.inventory_asset_account_id', 'is not', null)
    .where('sm.journal_entry_id', 'is', null)
    .executeTakeFirst();
  return toMoneyString(D(row?.value ?? '0'));
}

/**
 * Records, in one journal entry, the stock that was entered before inventory
 * reached the ledger: debit each Inventory account for its unposted value,
 * credit Opening Balance Equity. Run once per client, from the Inventory page.
 * Returns null when there is nothing to post.
 */
export async function postOpeningInventory(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { business_id: string; entry_date: string },
) {
  const pending = await trx.selectFrom('stock_movements as sm')
    .innerJoin('inventory_items as i', 'i.id', 'sm.inventory_item_id')
    .select(['sm.id', 'sm.total_cost', 'i.inventory_asset_account_id as account_id'])
    .where('i.business_id', '=', input.business_id)
    .where('i.inventory_asset_account_id', 'is not', null)
    .where('sm.journal_entry_id', 'is', null)
    .execute();
  if (pending.length === 0) return null;

  const byAccount = new Map<string, ReturnType<typeof D>>();
  for (const movement of pending) {
    const account = movement.account_id!;
    byAccount.set(account, (byAccount.get(account) ?? D(0)).plus(D(movement.total_cost ?? '0')));
  }
  const total = [...byAccount.values()].reduce((sum, value) => sum.plus(value), D(0));
  const memo = 'Opening inventory balance';
  const lines = [...byAccount.entries()].filter(([, value]) => !value.isZero()).map(([account_id, value]) => ({
    account_id,
    debit: value.gt(0) ? toMoneyString(value) : '0.0000',
    credit: value.lt(0) ? toMoneyString(value.abs()) : '0.0000',
    memo,
  }));

  let entryId: string | null = null;
  if (lines.length > 0) {
    // Two inventory accounts can offset each other exactly, leaving nothing for equity.
    if (!total.isZero()) {
      const equity = await getOrCreateOpeningBalanceEquity(trx, ctx, input.business_id);
      lines.push({
        account_id: equity.id,
        debit: total.lt(0) ? toMoneyString(total.abs()) : '0.0000',
        credit: total.gt(0) ? toMoneyString(total) : '0.0000',
        memo,
      });
    }
    const entry = await postJournalEntry(trx, ctx, {
      business_id: input.business_id,
      entry_date: input.entry_date,
      source_type: 'adjustment',
      memo,
      lines,
    });
    entryId = entry.id;
    await trx.updateTable('stock_movements').set({ journal_entry_id: entry.id })
      .where('id', 'in', pending.map(movement => movement.id)).execute();
  }
  return { journal_entry_id: entryId, movement_count: pending.length, value: toMoneyString(total) };
}
