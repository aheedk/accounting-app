import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { AccountType, DB, InventoryItemsTable } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type InventoryItem = Selectable<InventoryItemsTable>;

export type InventoryItemWithQty = InventoryItem & {
  quantity_on_hand: string;
};

export type CreateInventoryItemInput = {
  business_id: string;
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: string;
  purchase_cost: string | null;
  sale_price: string | null;
  income_account_id: string | null;
  expense_account_id: string | null;
  inventory_asset_account_id: string | null;
};

export type InventoryItemPatch = Partial<{
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: string;
  purchase_cost: string | null;
  sale_price: string | null;
  income_account_id: string | null;
  expense_account_id: string | null;
  inventory_asset_account_id: string | null;
  is_active: boolean;
}>;

export type UpdateInventoryItemInput = {
  business_id: string;
  item_id: string;
  patch: InventoryItemPatch;
};

export type DeleteInventoryItemInput = {
  business_id: string;
  item_id: string;
};

async function assertAccountType(
  trx: Transaction<DB>,
  business_id: string,
  account_id: string,
  expected: AccountType,
  label: string,
): Promise<void> {
  const row = await trx.selectFrom('chart_of_accounts')
    .select(['id', 'business_id', 'account_type'])
    .where('id', '=', account_id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('chart_of_accounts', account_id);
  if (row.business_id !== business_id) {
    throw new PreconditionError(`${label} does not belong to business`, { account_id });
  }
  if (row.account_type !== expected) {
    throw new PreconditionError(`${label} must be a ${expected} account`, {
      account_id,
      actual: row.account_type,
    });
  }
}

async function assertAccountRefs(
  trx: Transaction<DB>,
  business_id: string,
  refs: {
    income_account_id?: string | null | undefined;
    expense_account_id?: string | null | undefined;
    inventory_asset_account_id?: string | null | undefined;
  },
): Promise<void> {
  if (refs.income_account_id) {
    await assertAccountType(trx, business_id, refs.income_account_id, 'revenue', 'income_account');
  }
  if (refs.expense_account_id) {
    await assertAccountType(trx, business_id, refs.expense_account_id, 'expense', 'expense_account');
  }
  if (refs.inventory_asset_account_id) {
    await assertAccountType(
      trx,
      business_id,
      refs.inventory_asset_account_id,
      'asset',
      'inventory_asset_account',
    );
  }
}

export async function createItem(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreateInventoryItemInput,
): Promise<InventoryItem> {
  const dup = await trx.selectFrom('inventory_items')
    .select('id')
    .where('business_id', '=', input.business_id)
    .where('sku', '=', input.sku)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (dup) {
    throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Inventory SKU ${input.sku} already exists`);
  }

  await assertAccountRefs(trx, input.business_id, input);

  const row = await trx.insertInto('inventory_items').values({
    business_id: input.business_id,
    sku: input.sku,
    name: input.name,
    description: input.description,
    unit_of_measure: input.unit_of_measure,
    purchase_cost: input.purchase_cost,
    sale_price: input.sale_price,
    income_account_id: input.income_account_id,
    expense_account_id: input.expense_account_id,
    inventory_asset_account_id: input.inventory_asset_account_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.INVENTORY_ITEM_CREATE,
    entity_type: 'inventory_item',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateItem(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: UpdateInventoryItemInput,
): Promise<InventoryItem> {
  const before = await trx.selectFrom('inventory_items').selectAll()
    .where('id', '=', input.item_id)
    .where('business_id', '=', input.business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('inventory_item', input.item_id);

  if (
    input.patch.sku !== undefined
    && input.patch.sku !== before.sku
  ) {
    const dup = await trx.selectFrom('inventory_items')
      .select('id')
      .where('business_id', '=', input.business_id)
      .where('sku', '=', input.patch.sku)
      .where('deleted_at', 'is', null)
      .where('id', '!=', input.item_id)
      .executeTakeFirst();
    if (dup) {
      throw new BusinessRuleError(
        ERR.DUPLICATE_RESOURCE,
        `Inventory SKU ${input.patch.sku} already exists`,
      );
    }
  }

  await assertAccountRefs(trx, input.business_id, {
    income_account_id: input.patch.income_account_id,
    expense_account_id: input.patch.expense_account_id,
    inventory_asset_account_id: input.patch.inventory_asset_account_id,
  });

  const updateSet: {
    sku?: string;
    name?: string;
    description?: string | null;
    unit_of_measure?: string;
    purchase_cost?: string | null;
    sale_price?: string | null;
    income_account_id?: string | null;
    expense_account_id?: string | null;
    inventory_asset_account_id?: string | null;
    is_active?: boolean;
  } = {};
  if (input.patch.sku !== undefined) updateSet.sku = input.patch.sku;
  if (input.patch.name !== undefined) updateSet.name = input.patch.name;
  if (input.patch.description !== undefined) updateSet.description = input.patch.description;
  if (input.patch.unit_of_measure !== undefined) updateSet.unit_of_measure = input.patch.unit_of_measure;
  if (input.patch.purchase_cost !== undefined) updateSet.purchase_cost = input.patch.purchase_cost;
  if (input.patch.sale_price !== undefined) updateSet.sale_price = input.patch.sale_price;
  if (input.patch.income_account_id !== undefined) updateSet.income_account_id = input.patch.income_account_id;
  if (input.patch.expense_account_id !== undefined) updateSet.expense_account_id = input.patch.expense_account_id;
  if (input.patch.inventory_asset_account_id !== undefined) updateSet.inventory_asset_account_id = input.patch.inventory_asset_account_id;
  if (input.patch.is_active !== undefined) updateSet.is_active = input.patch.is_active;

  const updated = await trx.updateTable('inventory_items')
    .set(updateSet)
    .where('id', '=', input.item_id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.INVENTORY_ITEM_UPDATE,
    entity_type: 'inventory_item',
    entity_id: input.item_id,
    before,
    after: updated,
  });
  return updated;
}

export async function deleteItem(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: DeleteInventoryItemInput,
): Promise<void> {
  const before = await trx.selectFrom('inventory_items').selectAll()
    .where('id', '=', input.item_id)
    .where('business_id', '=', input.business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('inventory_item', input.item_id);

  await trx.updateTable('inventory_items')
    .set({ deleted_at: sql`now()`, is_active: false })
    .where('id', '=', input.item_id)
    .execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.INVENTORY_ITEM_DELETE,
    entity_type: 'inventory_item',
    entity_id: input.item_id,
    before,
    after: null,
  });
}

export async function listItems(
  db: Kysely<DB>,
  business_id: string,
  opts: { include_inactive?: boolean } = {},
): Promise<InventoryItemWithQty[]> {
  let q = db.selectFrom('inventory_items as ii')
    .selectAll('ii')
    .select(eb =>
      eb.selectFrom('stock_movements as sm')
        .select(({ fn }) => fn.coalesce(fn.sum<string>('sm.quantity_delta'), sql.lit('0.0000')).as('qty'))
        .whereRef('sm.inventory_item_id', '=', 'ii.id')
        .as('quantity_on_hand'),
    )
    .where('ii.business_id', '=', business_id)
    .where('ii.deleted_at', 'is', null);
  if (!opts.include_inactive) q = q.where('ii.is_active', '=', true);
  const rows = await q.orderBy('ii.sku').execute();
  return rows.map(r => ({
    ...r,
    quantity_on_hand: r.quantity_on_hand ?? '0.0000',
  }));
}

export async function getItem(
  db: Kysely<DB>,
  business_id: string,
  item_id: string,
) {
  const row = await db.selectFrom('inventory_items as ii')
    .selectAll('ii')
    .select(eb =>
      eb.selectFrom('stock_movements as sm')
        .select(({ fn }) => fn.coalesce(fn.sum<string>('sm.quantity_delta'), sql.lit('0.0000')).as('qty'))
        .whereRef('sm.inventory_item_id', '=', 'ii.id')
        .as('quantity_on_hand'),
    )
    .where('ii.id', '=', item_id)
    .where('ii.business_id', '=', business_id)
    .where('ii.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('inventory_item', item_id);

  const movements = await db.selectFrom('stock_movements as sm')
    .leftJoin('users as u', 'u.id', 'sm.posted_by_user_id')
    .select([
      'sm.id',
      'sm.inventory_item_id',
      'sm.movement_date',
      'sm.quantity_delta',
      'sm.reason',
      'sm.memo',
      'sm.posted_by_user_id',
      'sm.created_at',
      'u.full_name as posted_by_name',
    ])
    .where('sm.inventory_item_id', '=', item_id)
    .orderBy('sm.movement_date', 'desc')
    .orderBy('sm.created_at', 'desc')
    .execute();

  return {
    ...row,
    quantity_on_hand: row.quantity_on_hand ?? '0.0000',
    stock_movements: movements,
  };
}
