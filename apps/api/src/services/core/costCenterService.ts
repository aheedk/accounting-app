import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function listCostCenters(
  db: Kysely<DB>,
  business_id: string,
  opts: { include_inactive?: boolean } = {},
) {
  let q = db.selectFrom('cost_centers')
    .select(['id', 'business_id', 'name', 'code', 'is_active', 'created_at', 'updated_at'])
    .where('business_id', '=', business_id)
    .where('deleted_at', 'is', null);
  if (!opts.include_inactive) q = q.where('is_active', '=', true);
  return q.orderBy('name').execute();
}

export async function getCostCenter(
  db: Kysely<DB>, business_id: string, cost_center_id: string,
) {
  const row = await db.selectFrom('cost_centers')
    .select(['id', 'business_id', 'name', 'code', 'is_active', 'created_at', 'updated_at'])
    .where('id', '=', cost_center_id)
    .where('business_id', '=', business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('cost_center', cost_center_id);
  return row;
}

export async function createCostCenter(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { business_id: string; name: string; code: string | null; is_active: boolean },
) {
  if (input.code) {
    const dup = await trx.selectFrom('cost_centers')
      .select('id')
      .where('business_id', '=', input.business_id)
      .where('code', '=', input.code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (dup) {
      throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Cost center code ${input.code} already exists`);
    }
  }

  const row = await trx.insertInto('cost_centers').values({
    business_id: input.business_id,
    name: input.name,
    code: input.code,
    is_active: input.is_active,
  }).returning(['id', 'business_id', 'name', 'code', 'is_active', 'created_at', 'updated_at'])
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.COST_CENTER_CREATE,
    entity_type: 'cost_center',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateCostCenter(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: {
    business_id: string;
    cost_center_id: string;
    patch: { name?: string; code?: string | null; is_active?: boolean };
  },
) {
  const before = await trx.selectFrom('cost_centers').selectAll()
    .where('id', '=', input.cost_center_id)
    .where('business_id', '=', input.business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('cost_center', input.cost_center_id);

  if (input.patch.code !== undefined && input.patch.code !== null && input.patch.code !== before.code) {
    const dup = await trx.selectFrom('cost_centers')
      .select('id')
      .where('business_id', '=', input.business_id)
      .where('code', '=', input.patch.code)
      .where('deleted_at', 'is', null)
      .where('id', '!=', input.cost_center_id)
      .executeTakeFirst();
    if (dup) {
      throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Cost center code ${input.patch.code} already exists`);
    }
  }

  const updateSet: { name?: string; code?: string | null; is_active?: boolean } = {};
  if (input.patch.name !== undefined) updateSet.name = input.patch.name;
  if (input.patch.code !== undefined) updateSet.code = input.patch.code;
  if (input.patch.is_active !== undefined) updateSet.is_active = input.patch.is_active;

  const updated = await trx.updateTable('cost_centers')
    .set(updateSet)
    .where('id', '=', input.cost_center_id)
    .returning(['id', 'business_id', 'name', 'code', 'is_active', 'created_at', 'updated_at'])
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.COST_CENTER_UPDATE,
    entity_type: 'cost_center',
    entity_id: input.cost_center_id,
    before,
    after: updated,
  });
  return updated;
}

export async function deleteCostCenter(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { business_id: string; cost_center_id: string },
): Promise<void> {
  const before = await trx.selectFrom('cost_centers').selectAll()
    .where('id', '=', input.cost_center_id)
    .where('business_id', '=', input.business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('cost_center', input.cost_center_id);

  await trx.updateTable('cost_centers')
    .set({ deleted_at: sql`now()`, is_active: false })
    .where('id', '=', input.cost_center_id)
    .execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.COST_CENTER_DELETE,
    entity_type: 'cost_center',
    entity_id: input.cost_center_id,
    before,
    after: null,
  });
}
