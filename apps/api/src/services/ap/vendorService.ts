import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateVendorInput = {
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  billing_address?: unknown;
  default_terms_days?: number;
  is_1099?: boolean;
  tax_id?: string | null;
};

export async function createVendor(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateVendorInput) {
  const dup = await trx.selectFrom('vendors').select('id')
    .where('business_id', '=', input.business_id).where('name', '=', input.name).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Vendor "${input.name}" already exists`);

  const values: {
    business_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    billing_address: unknown | null;
    default_terms_days?: number;
    is_1099?: boolean;
    tax_id: string | null;
  } = {
    business_id: input.business_id,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    billing_address: input.billing_address === undefined ? null : (input.billing_address ?? null),
    tax_id: input.tax_id ?? null,
  };
  if (input.default_terms_days !== undefined) values.default_terms_days = input.default_terms_days;
  if (input.is_1099 !== undefined) values.is_1099 = input.is_1099;

  const row = await trx.insertInto('vendors').values(values).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.VENDOR_CREATE, entity_type: 'vendor', entity_id: row.id, before: null, after: row });
  return row;
}

export async function updateVendor(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { vendor_id: string; patch: Partial<CreateVendorInput> },
) {
  const before = await trx.selectFrom('vendors').selectAll().where('id', '=', input.vendor_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('vendor', input.vendor_id);

  const updated = await trx.updateTable('vendors').set({
    ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
    ...(input.patch.email !== undefined ? { email: input.patch.email ?? null } : {}),
    ...(input.patch.phone !== undefined ? { phone: input.patch.phone ?? null } : {}),
    ...(input.patch.billing_address !== undefined ? { billing_address: input.patch.billing_address ?? null } : {}),
    ...(input.patch.default_terms_days !== undefined ? { default_terms_days: input.patch.default_terms_days } : {}),
    ...(input.patch.is_1099 !== undefined ? { is_1099: input.patch.is_1099 } : {}),
    ...(input.patch.tax_id !== undefined ? { tax_id: input.patch.tax_id ?? null } : {}),
  }).where('id', '=', input.vendor_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.VENDOR_UPDATE, entity_type: 'vendor', entity_id: input.vendor_id, before, after: updated });
  return updated;
}

export async function deleteVendor(trx: Transaction<DB>, ctx: ServiceCtx, input: { vendor_id: string }) {
  const before = await trx.selectFrom('vendors').selectAll().where('id', '=', input.vendor_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('vendor', input.vendor_id);

  const liveBills = await trx.selectFrom('bills').select('id')
    .where('vendor_id', '=', input.vendor_id).where('status', 'in', ['draft', 'posted', 'paid'])
    .where('deleted_at', 'is', null).execute();
  if (liveBills.length > 0) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED,
      `Vendor has ${liveBills.length} active bill(s); void or delete them first`,
      { live_bill_ids: liveBills.map(i => i.id) });
  }

  await trx.updateTable('vendors').set({ deleted_at: sql`now()` }).where('id', '=', input.vendor_id).execute();
  await auditRecord(trx, ctx, { action: AUDIT.VENDOR_DELETE, entity_type: 'vendor', entity_id: input.vendor_id, before, after: null });
}

export async function listVendors(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('vendors').selectAll()
    .where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .orderBy('name').execute();
}

export async function getVendor(db: Kysely<DB>, business_id: string, vendor_id: string) {
  const v = await db.selectFrom('vendors').selectAll()
    .where('id', '=', vendor_id).where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!v) throw new NotFoundError('vendor', vendor_id);
  return v;
}
