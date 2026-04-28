import type { Kysely, Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, BusinessAddress } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type BusinessPatch = {
  name?: string;
  legal_name?: string | null;
  tax_id?: string | null;
  fiscal_year_start_month?: number;
  address?: BusinessAddress | null;
};

export async function getBusiness(db: Kysely<DB>, business_id: string) {
  const row = await db.selectFrom('businesses')
    .select([
      'id', 'firm_id', 'name', 'legal_name', 'tax_id',
      'fiscal_year_start_month', 'address', 'created_at', 'updated_at',
    ])
    .where('id', '=', business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('business', business_id);
  return row;
}

export async function updateBusiness(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { business_id: string; patch: BusinessPatch },
) {
  const before = await trx.selectFrom('businesses').selectAll()
    .where('id', '=', input.business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('business', input.business_id);

  const updateSet: {
    name?: string;
    legal_name?: string | null;
    tax_id?: string | null;
    fiscal_year_start_month?: number;
    address?: string | null;
  } = {};
  if (input.patch.name !== undefined) updateSet.name = input.patch.name;
  if (input.patch.legal_name !== undefined) updateSet.legal_name = input.patch.legal_name;
  if (input.patch.tax_id !== undefined) updateSet.tax_id = input.patch.tax_id;
  if (input.patch.fiscal_year_start_month !== undefined) {
    updateSet.fiscal_year_start_month = input.patch.fiscal_year_start_month;
  }
  if (input.patch.address !== undefined) {
    updateSet.address = input.patch.address === null ? null : JSON.stringify(input.patch.address);
  }

  const updated = await trx.updateTable('businesses')
    .set(updateSet)
    .where('id', '=', input.business_id)
    .returning([
      'id', 'firm_id', 'name', 'legal_name', 'tax_id',
      'fiscal_year_start_month', 'address', 'created_at', 'updated_at',
    ])
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BUSINESS_UPDATE,
    entity_type: 'business',
    entity_id: input.business_id,
    before,
    after: updated,
  });
  return updated;
}
