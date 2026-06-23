import { sql, type Kysely, type Transaction } from 'kysely';
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

export type BusinessCreateInput = {
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  fiscal_year_start_month?: number;
  address?: BusinessAddress | null;
};

const BUSINESS_COLUMNS = [
  'id', 'firm_id', 'name', 'legal_name', 'tax_id',
  'fiscal_year_start_month', 'address', 'created_at', 'updated_at',
] as const;

// Creates a new client business under the caller's firm, seeds it with the
// default chart of accounts + current-year fiscal periods (so it is usable
// immediately), and grants the creating user access so it appears in their
// company switcher.
export async function createBusiness(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: BusinessCreateInput,
) {
  const values: {
    firm_id: string;
    name: string;
    legal_name: string | null;
    tax_id: string | null;
    fiscal_year_start_month?: number;
    address: string | null;
  } = {
    firm_id: ctx.firm_id,
    name: input.name,
    legal_name: input.legal_name ?? null,
    tax_id: input.tax_id ?? null,
    address: input.address == null ? null : JSON.stringify(input.address),
  };
  if (input.fiscal_year_start_month !== undefined) {
    values.fiscal_year_start_month = input.fiscal_year_start_month;
  }

  const created = await trx.insertInto('businesses')
    .values(values)
    .returning(BUSINESS_COLUMNS)
    .executeTakeFirstOrThrow();

  // Bootstrap usable defaults via the shared SQL helpers (see migration 0009).
  await sql`SELECT seed_default_coa(${created.id}::uuid)`.execute(trx);
  await sql`SELECT seed_calendar_year_periods(${created.id}::uuid, ${new Date().getFullYear()}::int)`.execute(trx);

  // Grant the creator access so the new client shows up in /me.
  await trx.insertInto('user_business_access')
    .values({ user_id: ctx.user_id, business_id: created.id })
    .execute();

  const bizCtx: ServiceCtx = { ...ctx, business_id: created.id };
  await auditRecord(trx, bizCtx, {
    action: AUDIT.BUSINESS_CREATE,
    entity_type: 'business',
    entity_id: created.id,
    before: null,
    after: created,
  });
  await auditRecord(trx, bizCtx, {
    action: AUDIT.USER_BUSINESS_ACCESS_GRANT,
    entity_type: 'user_business_access',
    entity_id: created.id,
    before: null,
    after: { user_id: ctx.user_id, business_id: created.id },
  });

  return created;
}

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
