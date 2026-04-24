import { type Kysely, type Selectable, sql, type Transaction } from 'kysely';
import { AUDIT, subMoney, toMoneyString } from '@accounting/shared';
import type { DB, FixedAssetsTable } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type FixedAsset = Selectable<FixedAssetsTable>;

export type CreateFixedAssetInput = {
  business_id: string;
  name: string;
  asset_account_id: string;
  depreciation_expense_account_id: string;
  accumulated_depreciation_account_id: string;
  purchase_date: string;
  cost: string;
  salvage_value: string;
  useful_life_years: number;
  memo: string | null;
};

export type UpdateFixedAssetInput = {
  fixed_asset_id: string;
  patch: Partial<{
    name: string;
    memo: string | null;
  }>;
};

async function loadAccount(
  trx: Transaction<DB>, business_id: string, account_id: string, label: string,
) {
  const row = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', account_id).executeTakeFirst();
  if (!row) throw new NotFoundError('chart_of_accounts', account_id);
  if (row.business_id !== business_id) {
    throw new PreconditionError(`${label} does not belong to business`, { account_id });
  }
  return row;
}

export async function createFixedAsset(
  trx: Transaction<DB>, ctx: ServiceCtx, input: CreateFixedAssetInput,
): Promise<FixedAsset> {
  if (parseFloat(input.cost) <= parseFloat(input.salvage_value)) {
    throw new PreconditionError('cost must be greater than salvage_value', {
      cost: input.cost, salvage_value: input.salvage_value,
    });
  }

  const assetAcct = await loadAccount(trx, input.business_id, input.asset_account_id, 'asset_account');
  if (assetAcct.account_type !== 'asset') {
    throw new PreconditionError('asset_account must be an asset account');
  }
  const depExpAcct = await loadAccount(
    trx, input.business_id, input.depreciation_expense_account_id, 'depreciation_expense_account',
  );
  if (depExpAcct.account_type !== 'expense') {
    throw new PreconditionError('depreciation_expense_account must be an expense account');
  }
  const accumDepAcct = await loadAccount(
    trx, input.business_id, input.accumulated_depreciation_account_id, 'accumulated_depreciation_account',
  );
  if (accumDepAcct.account_type !== 'asset') {
    throw new PreconditionError('accumulated_depreciation_account must be an asset account');
  }

  const row = await trx.insertInto('fixed_assets').values({
    business_id: input.business_id,
    name: input.name,
    asset_account_id: input.asset_account_id,
    depreciation_expense_account_id: input.depreciation_expense_account_id,
    accumulated_depreciation_account_id: input.accumulated_depreciation_account_id,
    purchase_date: input.purchase_date,
    cost: input.cost,
    salvage_value: input.salvage_value,
    useful_life_years: input.useful_life_years,
    memo: input.memo,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.FIXED_ASSET_CREATE,
    entity_type: 'fixed_asset',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateFixedAsset(
  trx: Transaction<DB>, ctx: ServiceCtx, input: UpdateFixedAssetInput,
): Promise<FixedAsset> {
  const before = await trx.selectFrom('fixed_assets').selectAll()
    .where('id', '=', input.fixed_asset_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('fixed_asset', input.fixed_asset_id);

  const updated = await trx.updateTable('fixed_assets').set({
    ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
    ...(input.patch.memo !== undefined ? { memo: input.patch.memo } : {}),
  }).where('id', '=', input.fixed_asset_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.FIXED_ASSET_UPDATE,
    entity_type: 'fixed_asset',
    entity_id: input.fixed_asset_id,
    before,
    after: updated,
  });
  return updated;
}

export type FixedAssetWithAccumulation = FixedAsset & {
  accumulated_depreciation: string;
  book_value: string;
};

function computeBookValue(cost: string, accumulated: string): string {
  return toMoneyString(subMoney(cost, accumulated));
}

export async function listFixedAssets(
  db: Kysely<DB>, business_id: string,
): Promise<FixedAssetWithAccumulation[]> {
  const rows = await db.selectFrom('fixed_assets as fa')
    .selectAll('fa')
    .select(eb =>
      eb.selectFrom('depreciation_entries as de')
        .select(({ fn }) => fn.coalesce(fn.sum<string>('de.amount'), sql.lit('0.0000')).as('accumulated'))
        .whereRef('de.fixed_asset_id', '=', 'fa.id')
        .as('accumulated_depreciation'),
    )
    .where('fa.business_id', '=', business_id)
    .where('fa.deleted_at', 'is', null)
    .orderBy('fa.created_at')
    .execute();

  return rows.map(r => {
    const accumulated = toMoneyString(r.accumulated_depreciation ?? '0.0000');
    return {
      ...r,
      accumulated_depreciation: accumulated,
      book_value: computeBookValue(r.cost, accumulated),
    };
  });
}

export async function getFixedAsset(
  db: Kysely<DB>, business_id: string, fixed_asset_id: string,
): Promise<FixedAssetWithAccumulation> {
  const row = await db.selectFrom('fixed_assets as fa')
    .selectAll('fa')
    .select(eb =>
      eb.selectFrom('depreciation_entries as de')
        .select(({ fn }) => fn.coalesce(fn.sum<string>('de.amount'), sql.lit('0.0000')).as('accumulated'))
        .whereRef('de.fixed_asset_id', '=', 'fa.id')
        .as('accumulated_depreciation'),
    )
    .where('fa.id', '=', fixed_asset_id)
    .where('fa.business_id', '=', business_id)
    .where('fa.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('fixed_asset', fixed_asset_id);

  const accumulated = toMoneyString(row.accumulated_depreciation ?? '0.0000');
  return {
    ...row,
    accumulated_depreciation: accumulated,
    book_value: computeBookValue(row.cost, accumulated),
  };
}
