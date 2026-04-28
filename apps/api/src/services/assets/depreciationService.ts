import type { Kysely, Transaction } from 'kysely';
import { Decimal } from 'decimal.js';
import { AUDIT, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type RunDepreciationInput = {
  fixed_asset_id: string;
  period_end: string;
};

export async function runDepreciation(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: RunDepreciationInput,
) {
  const asset = await trx.selectFrom('fixed_assets').selectAll()
    .where('id', '=', input.fixed_asset_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!asset) throw new NotFoundError('fixed_asset', input.fixed_asset_id);
  if (asset.status !== 'active') {
    throw new InvalidStateTransitionError('fixed_asset', asset.id, asset.status, 'depreciate');
  }

  // Idempotency: one depreciation entry per (asset, period_end).
  const existing = await trx.selectFrom('depreciation_entries').select('id')
    .where('fixed_asset_id', '=', asset.id)
    .where('period_end', '=', input.period_end)
    .executeTakeFirst();
  if (existing) {
    throw new PreconditionError(
      `Depreciation already posted for ${asset.name} through ${input.period_end}`,
      { fixed_asset_id: asset.id, period_end: input.period_end },
    );
  }

  // Straight-line monthly depreciation = (cost - salvage) / (useful_life_years * 12).
  const cost = new Decimal(asset.cost);
  const salvage = new Decimal(asset.salvage_value);
  const monthsTotal = asset.useful_life_years * 12;
  const monthly = cost.minus(salvage).div(monthsTotal);
  const amount = toMoneyString(monthly);

  // DR depreciation expense, CR accumulated depreciation.
  const je = await postJournalEntry(trx, ctx, {
    business_id: asset.business_id,
    entry_date: input.period_end,
    source_type: 'manual',
    source_id: null,
    memo: `Depreciation: ${asset.name} through ${input.period_end}`,
    reference: null,
    lines: [
      { account_id: asset.depreciation_expense_account_id, debit: amount, credit: '0.0000', memo: null },
      { account_id: asset.accumulated_depreciation_account_id, debit: '0.0000', credit: amount, memo: null },
    ],
  });

  const entry = await trx.insertInto('depreciation_entries').values({
    fixed_asset_id: asset.id,
    period_end: input.period_end,
    amount,
    journal_entry_id: je.id,
    posted_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.FIXED_ASSET_DEPRECIATE,
    entity_type: 'fixed_asset',
    entity_id: asset.id,
    before: null,
    after: {
      fixed_asset_id: asset.id,
      period_end: input.period_end,
      amount,
      journal_entry_id: je.id,
    },
  });

  return entry;
}

export async function listDepreciationEntries(
  db: Kysely<DB>,
  business_id: string,
  fixed_asset_id: string,
) {
  return db.selectFrom('depreciation_entries as de')
    .innerJoin('fixed_assets as a', 'a.id', 'de.fixed_asset_id')
    .selectAll('de')
    .where('de.fixed_asset_id', '=', fixed_asset_id)
    .where('a.business_id', '=', business_id)
    .orderBy('de.period_end', 'desc')
    .execute();
}
