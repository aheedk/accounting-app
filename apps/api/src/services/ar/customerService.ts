import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateCustomerInput = {
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  billing_address?: unknown;
  default_terms_days?: number;
};

export async function createCustomer(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateCustomerInput) {
  const dup = await trx.selectFrom('customers').select('id')
    .where('business_id', '=', input.business_id).where('name', '=', input.name).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Customer "${input.name}" already exists`);

  const values: {
    business_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    billing_address: unknown | null;
    default_terms_days?: number;
  } = {
    business_id: input.business_id,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    billing_address: input.billing_address === undefined ? null : (input.billing_address ?? null),
  };
  if (input.default_terms_days !== undefined) values.default_terms_days = input.default_terms_days;

  const row = await trx.insertInto('customers').values(values).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.CUSTOMER_CREATE, entity_type: 'customer', entity_id: row.id, before: null, after: row });
  return row;
}

export async function updateCustomer(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { customer_id: string; patch: Partial<CreateCustomerInput> },
) {
  const before = await trx.selectFrom('customers').selectAll().where('id', '=', input.customer_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('customer', input.customer_id);

  const updated = await trx.updateTable('customers').set({
    ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
    ...(input.patch.email !== undefined ? { email: input.patch.email ?? null } : {}),
    ...(input.patch.phone !== undefined ? { phone: input.patch.phone ?? null } : {}),
    ...(input.patch.billing_address !== undefined ? { billing_address: input.patch.billing_address ?? null } : {}),
    ...(input.patch.default_terms_days !== undefined ? { default_terms_days: input.patch.default_terms_days } : {}),
  }).where('id', '=', input.customer_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.CUSTOMER_UPDATE, entity_type: 'customer', entity_id: input.customer_id, before, after: updated });
  return updated;
}

export async function deleteCustomer(trx: Transaction<DB>, ctx: ServiceCtx, input: { customer_id: string }) {
  const before = await trx.selectFrom('customers').selectAll().where('id', '=', input.customer_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('customer', input.customer_id);

  const liveInvoices = await trx.selectFrom('invoices').select('id')
    .where('customer_id', '=', input.customer_id).where('status', 'in', ['draft', 'posted', 'paid'])
    .where('deleted_at', 'is', null).execute();
  if (liveInvoices.length > 0) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED,
      `Customer has ${liveInvoices.length} active invoice(s); void or delete them first`,
      { live_invoice_ids: liveInvoices.map(i => i.id) });
  }

  await trx.updateTable('customers').set({ deleted_at: sql`now()` }).where('id', '=', input.customer_id).execute();
  await auditRecord(trx, ctx, { action: AUDIT.CUSTOMER_DELETE, entity_type: 'customer', entity_id: input.customer_id, before, after: null });
}

export async function listCustomers(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('customers').selectAll()
    .where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .orderBy('name').execute();
}

export async function getCustomer(db: Kysely<DB>, business_id: string, customer_id: string) {
  const c = await db.selectFrom('customers').selectAll()
    .where('id', '=', customer_id).where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!c) throw new NotFoundError('customer', customer_id);
  return c;
}
