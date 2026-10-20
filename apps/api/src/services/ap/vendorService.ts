import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { scopeBusiness, type ServiceCtx } from '../../lib/ctx.js';
import { encryptField, decryptField, lastFour } from '../../lib/fieldCrypto.js';

export type CreateVendorInput = {
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  billing_address?: unknown;
  default_terms_days?: number;
  is_1099?: boolean;
  is_active?: boolean;
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
    is_active?: boolean;
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
  if (input.is_active !== undefined) values.is_active = input.is_active;

  const row = await trx.insertInto('vendors').values(values).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.VENDOR_CREATE, entity_type: 'vendor', entity_id: row.id, before: null, after: row });
  return row;
}

export async function updateVendor(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { vendor_id: string; patch: Partial<CreateVendorInput> },
) {
  const before = await trx.selectFrom('vendors').selectAll().where('id', '=', input.vendor_id).where('business_id', '=', scopeBusiness(ctx)).executeTakeFirst();
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
    ...(input.patch.is_active !== undefined ? { is_active: input.patch.is_active } : {}),
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

  const action = input.patch.is_active === false
    ? AUDIT.VENDOR_DEACTIVATE
    : input.patch.is_active === true
      ? AUDIT.VENDOR_REACTIVATE
      : AUDIT.VENDOR_UPDATE;
  await auditRecord(trx, ctx, { action, entity_type: 'vendor', entity_id: input.vendor_id, before, after: updated });
  return updated;
}

// Every table that can point at a vendor. A vendor with any row in any of
// these is history that must be kept readable, so Delete refuses it outright
// — Make inactive (is_active) is the reversible option for that vendor.
export async function vendorHasAnyTransaction(db: Kysely<DB> | Transaction<DB>, vendor_id: string): Promise<boolean> {
  const [expense, po, bill, billPayment, vendorCredit] = await Promise.all([
    db.selectFrom('expense_transactions').select('id').where('vendor_id', '=', vendor_id).executeTakeFirst(),
    db.selectFrom('purchase_orders').select('id').where('vendor_id', '=', vendor_id).executeTakeFirst(),
    db.selectFrom('bills').select('id').where('vendor_id', '=', vendor_id).executeTakeFirst(),
    db.selectFrom('bill_payments').select('id').where('vendor_id', '=', vendor_id).executeTakeFirst(),
    db.selectFrom('vendor_credits').select('id').where('vendor_id', '=', vendor_id).executeTakeFirst(),
  ]);
  return [expense, po, bill, billPayment, vendorCredit].some(row => row !== undefined);
}

/** Vendor ids (within this business) that have at least one transaction on
 * file, for graying out Delete in the vendor list without a round trip per row. */
export async function vendorIdsWithTransactions(db: Kysely<DB>, business_id: string): Promise<Set<string>> {
  const [expenses, pos, bills, billPayments, vendorCredits] = await Promise.all([
    db.selectFrom('expense_transactions').select('vendor_id')
      .where('business_id', '=', business_id).where('vendor_id', 'is not', null).distinct().execute(),
    db.selectFrom('purchase_orders').select('vendor_id')
      .where('business_id', '=', business_id).distinct().execute(),
    db.selectFrom('bills').select('vendor_id')
      .where('business_id', '=', business_id).distinct().execute(),
    db.selectFrom('bill_payments').select('vendor_id')
      .where('business_id', '=', business_id).distinct().execute(),
    db.selectFrom('vendor_credits').select('vendor_id')
      .where('business_id', '=', business_id).distinct().execute(),
  ]);
  const ids = new Set<string>();
  for (const rows of [expenses, pos, bills, billPayments, vendorCredits]) {
    for (const row of rows) if (row.vendor_id) ids.add(row.vendor_id);
  }
  return ids;
}

export async function deleteVendor(trx: Transaction<DB>, ctx: ServiceCtx, input: { vendor_id: string }) {
  const before = await trx.selectFrom('vendors').selectAll().where('id', '=', input.vendor_id).where('business_id', '=', scopeBusiness(ctx)).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('vendor', input.vendor_id);

  if (await vendorHasAnyTransaction(trx, input.vendor_id)) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED,
      'Cannot delete — vendor has existing transactions. Use "Make inactive" instead.');
  }

  await trx.deleteFrom('vendors').where('id', '=', input.vendor_id).execute();
  await auditRecord(trx, ctx, { action: AUDIT.VENDOR_DELETE, entity_type: 'vendor', entity_id: input.vendor_id, before, after: null });
}

/**
 * Merge `from_vendor_id` into `into_vendor_id`: every record that points at
 * the "from" vendor is repointed at the "into" vendor, then the "from"
 * vendor is permanently deleted. The surviving vendor keeps its own id, name
 * and settings untouched — only the other side's history moves over.
 *
 * Every table with a real FK to vendors gets reassigned: expense_transactions,
 * checks (payee_id, vendor payees only), bills, bill_payments, vendor_credits,
 * purchase_orders, vendor_notes. journal_entry_lines carries no vendor
 * reference of its own (a JE's "contact" is read off its source document, via
 * the unified transactions query) and bank_deposit_lines.received_from is
 * free text, not a vendor_id — so neither needs a reassignment pass; moving
 * the source documents already carries the JE's and the deposit line's vendor
 * association along with them.
 *
 * Conflict rule: QBO refuses a merge across a currency or tax id mismatch.
 * This app has no per-vendor currency at all (single-currency books), so
 * that half never applies here; a tax id set on both sides that doesn't
 * match is the one real conflict, checked by decrypting both.
 */
export async function mergeVendors(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { from_vendor_id: string; into_vendor_id: string },
) {
  const bizId = ctx.business_id!;
  if (input.from_vendor_id === input.into_vendor_id) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'Pick a different vendor to merge into');
  }

  const [from, into] = await Promise.all([
    trx.selectFrom('vendors').selectAll().where('id', '=', input.from_vendor_id).where('business_id', '=', bizId).executeTakeFirst(),
    trx.selectFrom('vendors').selectAll().where('id', '=', input.into_vendor_id).where('business_id', '=', bizId).executeTakeFirst(),
  ]);
  if (!from) throw new NotFoundError('vendor', input.from_vendor_id);
  if (!into) throw new NotFoundError('vendor', input.into_vendor_id);

  if (from.tax_id_encrypted && into.tax_id_encrypted) {
    const fromTaxId = decryptField(Buffer.from(from.tax_id_encrypted));
    const intoTaxId = decryptField(Buffer.from(into.tax_id_encrypted));
    if (fromTaxId !== intoTaxId) {
      throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'These vendors have different tax IDs on file and cannot be merged.');
    }
  }

  await trx.updateTable('expense_transactions').set({ vendor_id: input.into_vendor_id })
    .where('vendor_id', '=', input.from_vendor_id).where('business_id', '=', bizId).execute();
  await trx.updateTable('checks').set({ payee_id: input.into_vendor_id })
    .where('payee_id', '=', input.from_vendor_id).where('payee_type', '=', 'vendor').where('business_id', '=', bizId).execute();
  await trx.updateTable('bills').set({ vendor_id: input.into_vendor_id })
    .where('vendor_id', '=', input.from_vendor_id).where('business_id', '=', bizId).execute();
  await trx.updateTable('bill_payments').set({ vendor_id: input.into_vendor_id })
    .where('vendor_id', '=', input.from_vendor_id).where('business_id', '=', bizId).execute();
  await trx.updateTable('vendor_credits').set({ vendor_id: input.into_vendor_id })
    .where('vendor_id', '=', input.from_vendor_id).where('business_id', '=', bizId).execute();
  await trx.updateTable('purchase_orders').set({ vendor_id: input.into_vendor_id })
    .where('vendor_id', '=', input.from_vendor_id).where('business_id', '=', bizId).execute();
  await trx.updateTable('vendor_notes').set({ vendor_id: input.into_vendor_id })
    .where('vendor_id', '=', input.from_vendor_id).where('business_id', '=', bizId).execute();

  await trx.deleteFrom('vendors').where('id', '=', input.from_vendor_id).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.VENDOR_MERGE,
    entity_type: 'vendor',
    entity_id: input.into_vendor_id,
    // Full snapshot of the deleted vendor, as required: it no longer exists
    // anywhere else once this commits.
    before: from,
    // The audit row itself already carries who and when (user_id, created_at)
    // — this just names both vendors in the one place a reader can't get that
    // from the id alone, since "from" is gone after this commits.
    after: {
      summary: `Vendor "${from.name}" merged into Vendor "${into.name}"`,
      merged_from_vendor_id: input.from_vendor_id,
      merged_from_name: from.name,
      merged_into_vendor_id: input.into_vendor_id,
      merged_into_name: into.name,
    },
  });

  return trx.selectFrom('vendors').selectAll().where('id', '=', input.into_vendor_id).where('business_id', '=', scopeBusiness(ctx)).executeTakeFirstOrThrow();
}

/**
 * Open balance = outstanding posted bills (net of what's already applied to
 * them) minus this vendor's own unused credit: vendor credits not yet
 * applied, and bill payments with money left over unapplied. Same shape as
 * apOverviewService's business-wide net_payable_total, just grouped per
 * vendor instead of summed across all of them — a vendor with more credit
 * than it owes reads as a negative balance, same as QuickBooks.
 */
export async function listVendors(
  db: Kysely<DB>, business_id: string, opts: { includeInactive?: boolean } = {},
) {
  let q = db.selectFrom('vendors as v')
    .selectAll('v')
    .select(eb => [
      eb.selectFrom('bills as b')
        .leftJoin(
          eb2 => eb2.selectFrom('bill_payment_applications')
            .select(['bill_id', ({ fn }) => fn.sum<string>('applied_amount').as('applied')])
            .groupBy('bill_id')
            .as('p'),
          join => join.onRef('p.bill_id', '=', 'b.id'),
        )
        .select(({ fn }) => fn.coalesce(fn.sum<string>(sql<string>`b.total - COALESCE(p.applied, 0)`), sql.lit('0')).as('v'))
        .whereRef('b.vendor_id', '=', 'v.id')
        .where('b.status', '=', 'posted')
        .where('b.deleted_at', 'is', null)
        .as('outstanding_bills'),
      eb.selectFrom('vendor_credits')
        .select(({ fn }) => fn.coalesce(fn.sum<string>('remaining_amount'), sql.lit('0')).as('v'))
        .whereRef('vendor_id', '=', 'v.id')
        .where('status', 'in', ['posted', 'applied'])
        .as('unused_credits'),
      eb.selectFrom('bill_payments')
        .select(({ fn }) => fn.coalesce(fn.sum<string>('unapplied_amount'), sql.lit('0')).as('v'))
        .whereRef('vendor_id', '=', 'v.id')
        .where('status', '=', 'posted')
        .as('unapplied_payments'),
    ])
    .where('v.business_id', '=', business_id).where('v.deleted_at', 'is', null);
  if (!opts.includeInactive) q = q.where('v.is_active', '=', true);
  const rows = await q.orderBy('v.name').execute();
  return rows.map(({ outstanding_bills, unused_credits, unapplied_payments, ...v }) => ({
    ...v,
    open_balance: (Number(outstanding_bills) - Number(unused_credits) - Number(unapplied_payments)).toFixed(4),
  }));
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

export async function listVendorNotes(db: Kysely<DB>, business_id: string, vendor_id: string) {
  const rows = await db.selectFrom('vendor_notes as n')
    .innerJoin('users as u', 'u.id', 'n.user_id')
    .select(['n.id', 'n.note_text', 'n.created_at', 'n.user_id', 'u.full_name as author_name'])
    .where('n.business_id', '=', business_id)
    .where('n.vendor_id', '=', vendor_id)
    .orderBy('n.created_at', 'desc')
    .execute();
  return rows;
}

export async function addVendorNote(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { vendor_id: string; note_text: string },
) {
  const vendor = await trx.selectFrom('vendors').select('id')
    .where('id', '=', input.vendor_id).where('business_id', '=', ctx.business_id ?? '').where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!vendor) throw new NotFoundError('vendor', input.vendor_id);

  const row = await trx.insertInto('vendor_notes').values({
    business_id: ctx.business_id ?? '',
    vendor_id: input.vendor_id,
    user_id: ctx.user_id,
    note_text: input.note_text,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.VENDOR_NOTE_CREATE,
    entity_type: 'vendor',
    entity_id: input.vendor_id,
    before: null,
    after: row,
  });
  return row;
}
