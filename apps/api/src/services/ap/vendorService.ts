import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { encryptField, decryptField, lastFour } from '../../lib/fieldCrypto.js';

export type CreateVendorInput = {
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  billing_address?: unknown;
  default_terms_days?: number;
  is_1099?: boolean;
  tax_id?: string | null;        // plaintext; service encrypts
  tax_id_type?: 'SSN' | 'EIN' | null;
  // QBO-style expanded fields (mirrors customers).
  company_name?: string | null;
  title?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  suffix?: string | null;
  email_cc?: string | null;
  email_bcc?: string | null;
  mobile?: string | null;
  fax?: string | null;
  other_phone?: string | null;
  website?: string | null;
  name_on_checks?: string | null;
  notes?: string | null;
  account_number?: string | null;
  default_expense_account_id?: string | null;
  opening_balance?: string | null;
  opening_balance_as_of?: string | null;
};

export async function createVendor(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateVendorInput) {
  const dup = await trx.selectFrom('vendors').select('id')
    .where('business_id', '=', input.business_id).where('name', '=', input.name).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Vendor "${input.name}" already exists`);

  let tax_id_encrypted: Buffer | null = null;
  let tax_id_last_four: string | null = null;
  let tax_id_type: 'SSN' | 'EIN' | null = null;
  if (input.tax_id) {
    if (!input.tax_id_type) throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'tax_id_type is required when tax_id is set');
    tax_id_encrypted = encryptField(input.tax_id);
    tax_id_last_four = lastFour(input.tax_id);
    tax_id_type = input.tax_id_type;
  }

  const values: {
    business_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    billing_address: unknown | null;
    default_terms_days?: number;
    is_1099?: boolean;
    tax_id_encrypted: Buffer | null;
    tax_id_last_four: string | null;
    tax_id_type: 'SSN' | 'EIN' | null;
    company_name: string | null;
    title: string | null;
    first_name: string | null;
    middle_name: string | null;
    last_name: string | null;
    suffix: string | null;
    email_cc: string | null;
    email_bcc: string | null;
    mobile: string | null;
    fax: string | null;
    other_phone: string | null;
    website: string | null;
    name_on_checks: string | null;
    notes: string | null;
    account_number: string | null;
    default_expense_account_id: string | null;
    opening_balance: string | null;
    opening_balance_as_of: string | null;
  } = {
    business_id: input.business_id,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    billing_address: input.billing_address === undefined ? null : (input.billing_address ?? null),
    tax_id_encrypted,
    tax_id_last_four,
    tax_id_type,
    company_name: input.company_name ?? null,
    title: input.title ?? null,
    first_name: input.first_name ?? null,
    middle_name: input.middle_name ?? null,
    last_name: input.last_name ?? null,
    suffix: input.suffix ?? null,
    email_cc: input.email_cc ?? null,
    email_bcc: input.email_bcc ?? null,
    mobile: input.mobile ?? null,
    fax: input.fax ?? null,
    other_phone: input.other_phone ?? null,
    website: input.website ?? null,
    name_on_checks: input.name_on_checks ?? null,
    notes: input.notes ?? null,
    account_number: input.account_number ?? null,
    default_expense_account_id: input.default_expense_account_id ?? null,
    opening_balance: input.opening_balance ?? null,
    opening_balance_as_of: input.opening_balance_as_of ?? null,
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

  let taxIdPatch: Partial<{
    tax_id_encrypted: Buffer | null;
    tax_id_last_four: string | null;
    tax_id_type: 'SSN' | 'EIN' | null;
  }> = {};
  if (input.patch.tax_id !== undefined) {
    if (input.patch.tax_id === null) {
      taxIdPatch = { tax_id_encrypted: null, tax_id_last_four: null, tax_id_type: null };
    } else {
      if (!input.patch.tax_id_type) throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'tax_id_type is required when tax_id is set');
      taxIdPatch = {
        tax_id_encrypted: encryptField(input.patch.tax_id),
        tax_id_last_four: lastFour(input.patch.tax_id),
        tax_id_type: input.patch.tax_id_type,
      };
    }
  }

  const updated = await trx.updateTable('vendors').set({
    ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
    ...(input.patch.email !== undefined ? { email: input.patch.email ?? null } : {}),
    ...(input.patch.phone !== undefined ? { phone: input.patch.phone ?? null } : {}),
    ...(input.patch.billing_address !== undefined ? { billing_address: input.patch.billing_address ?? null } : {}),
    ...(input.patch.default_terms_days !== undefined ? { default_terms_days: input.patch.default_terms_days } : {}),
    ...(input.patch.is_1099 !== undefined ? { is_1099: input.patch.is_1099 } : {}),
    ...(input.patch.company_name !== undefined ? { company_name: input.patch.company_name ?? null } : {}),
    ...(input.patch.title !== undefined ? { title: input.patch.title ?? null } : {}),
    ...(input.patch.first_name !== undefined ? { first_name: input.patch.first_name ?? null } : {}),
    ...(input.patch.middle_name !== undefined ? { middle_name: input.patch.middle_name ?? null } : {}),
    ...(input.patch.last_name !== undefined ? { last_name: input.patch.last_name ?? null } : {}),
    ...(input.patch.suffix !== undefined ? { suffix: input.patch.suffix ?? null } : {}),
    ...(input.patch.email_cc !== undefined ? { email_cc: input.patch.email_cc ?? null } : {}),
    ...(input.patch.email_bcc !== undefined ? { email_bcc: input.patch.email_bcc ?? null } : {}),
    ...(input.patch.mobile !== undefined ? { mobile: input.patch.mobile ?? null } : {}),
    ...(input.patch.fax !== undefined ? { fax: input.patch.fax ?? null } : {}),
    ...(input.patch.other_phone !== undefined ? { other_phone: input.patch.other_phone ?? null } : {}),
    ...(input.patch.website !== undefined ? { website: input.patch.website ?? null } : {}),
    ...(input.patch.name_on_checks !== undefined ? { name_on_checks: input.patch.name_on_checks ?? null } : {}),
    ...(input.patch.notes !== undefined ? { notes: input.patch.notes ?? null } : {}),
    ...(input.patch.account_number !== undefined ? { account_number: input.patch.account_number ?? null } : {}),
    ...(input.patch.default_expense_account_id !== undefined ? { default_expense_account_id: input.patch.default_expense_account_id ?? null } : {}),
    ...(input.patch.opening_balance !== undefined ? { opening_balance: input.patch.opening_balance ?? null } : {}),
    ...(input.patch.opening_balance_as_of !== undefined ? { opening_balance_as_of: input.patch.opening_balance_as_of ?? null } : {}),
    ...taxIdPatch,
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

export async function revealTaxId(db: Kysely<DB>, ctx: ServiceCtx, input: { vendor_id: string }): Promise<string | null> {
  const v = await db.selectFrom('vendors').selectAll()
    .where('id', '=', input.vendor_id).where('business_id', '=', ctx.business_id ?? '').where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!v) throw new NotFoundError('vendor', input.vendor_id);
  await db.transaction().execute(async trx => {
    await auditRecord(trx, ctx, {
      action: AUDIT.VENDOR_TAX_ID_REVEAL,
      entity_type: 'vendor',
      entity_id: v.id,
      before: null,
      after: { revealed_by: ctx.user_id, last_four: v.tax_id_last_four },
    });
  });
  return v.tax_id_encrypted ? decryptField(Buffer.from(v.tax_id_encrypted)) : null;
}

export async function listContractors(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('vendors').selectAll()
    .where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .where('is_1099', '=', true)
    .orderBy('name').execute();
}
