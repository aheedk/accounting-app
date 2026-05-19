import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateCustomerInput = {
  business_id: string;
  name: string;
  company_name?: string | null;
  title?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  suffix?: string | null;
  email?: string | null;
  email_cc?: string | null;
  email_bcc?: string | null;
  phone?: string | null;
  mobile?: string | null;
  fax?: string | null;
  other_phone?: string | null;
  website?: string | null;
  name_on_checks?: string | null;
  billing_address?: unknown;
  shipping_address?: unknown;
  shipping_same_as_billing?: boolean;
  notes?: string | null;
  primary_payment_method?: string | null;
  sales_form_delivery?: string | null;
  invoice_language?: string;
  credit_limit?: string | null;
  customer_type?: string | null;
  tax_exemption_details?: string | null;
  opening_balance?: string | null;
  opening_balance_as_of?: string | null;
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
    company_name: string | null;
    title: string | null;
    first_name: string | null;
    middle_name: string | null;
    last_name: string | null;
    suffix: string | null;
    email: string | null;
    email_cc: string | null;
    email_bcc: string | null;
    phone: string | null;
    mobile: string | null;
    fax: string | null;
    other_phone: string | null;
    website: string | null;
    name_on_checks: string | null;
    billing_address: unknown | null;
    shipping_address: unknown | null;
    notes: string | null;
    primary_payment_method: string | null;
    sales_form_delivery: string | null;
    credit_limit: string | null;
    customer_type: string | null;
    tax_exemption_details: string | null;
    opening_balance: string | null;
    opening_balance_as_of: string | null;
    shipping_same_as_billing?: boolean;
    invoice_language?: string;
    default_terms_days?: number;
  } = {
    business_id: input.business_id,
    name: input.name,
    company_name: input.company_name ?? null,
    title: input.title ?? null,
    first_name: input.first_name ?? null,
    middle_name: input.middle_name ?? null,
    last_name: input.last_name ?? null,
    suffix: input.suffix ?? null,
    email: input.email ?? null,
    email_cc: input.email_cc ?? null,
    email_bcc: input.email_bcc ?? null,
    phone: input.phone ?? null,
    mobile: input.mobile ?? null,
    fax: input.fax ?? null,
    other_phone: input.other_phone ?? null,
    website: input.website ?? null,
    name_on_checks: input.name_on_checks ?? null,
    billing_address: input.billing_address === undefined ? null : (input.billing_address ?? null),
    shipping_address: input.shipping_address === undefined ? null : (input.shipping_address ?? null),
    notes: input.notes ?? null,
    primary_payment_method: input.primary_payment_method ?? null,
    sales_form_delivery: input.sales_form_delivery ?? null,
    credit_limit: input.credit_limit ?? null,
    customer_type: input.customer_type ?? null,
    tax_exemption_details: input.tax_exemption_details ?? null,
    opening_balance: input.opening_balance ?? null,
    opening_balance_as_of: input.opening_balance_as_of ?? null,
  };
  if (input.shipping_same_as_billing !== undefined) values.shipping_same_as_billing = input.shipping_same_as_billing;
  if (input.invoice_language !== undefined) values.invoice_language = input.invoice_language;
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
    ...(input.patch.company_name !== undefined ? { company_name: input.patch.company_name ?? null } : {}),
    ...(input.patch.title !== undefined ? { title: input.patch.title ?? null } : {}),
    ...(input.patch.first_name !== undefined ? { first_name: input.patch.first_name ?? null } : {}),
    ...(input.patch.middle_name !== undefined ? { middle_name: input.patch.middle_name ?? null } : {}),
    ...(input.patch.last_name !== undefined ? { last_name: input.patch.last_name ?? null } : {}),
    ...(input.patch.suffix !== undefined ? { suffix: input.patch.suffix ?? null } : {}),
    ...(input.patch.email !== undefined ? { email: input.patch.email ?? null } : {}),
    ...(input.patch.email_cc !== undefined ? { email_cc: input.patch.email_cc ?? null } : {}),
    ...(input.patch.email_bcc !== undefined ? { email_bcc: input.patch.email_bcc ?? null } : {}),
    ...(input.patch.phone !== undefined ? { phone: input.patch.phone ?? null } : {}),
    ...(input.patch.mobile !== undefined ? { mobile: input.patch.mobile ?? null } : {}),
    ...(input.patch.fax !== undefined ? { fax: input.patch.fax ?? null } : {}),
    ...(input.patch.other_phone !== undefined ? { other_phone: input.patch.other_phone ?? null } : {}),
    ...(input.patch.website !== undefined ? { website: input.patch.website ?? null } : {}),
    ...(input.patch.name_on_checks !== undefined ? { name_on_checks: input.patch.name_on_checks ?? null } : {}),
    ...(input.patch.billing_address !== undefined ? { billing_address: input.patch.billing_address ?? null } : {}),
    ...(input.patch.shipping_address !== undefined ? { shipping_address: input.patch.shipping_address ?? null } : {}),
    ...(input.patch.shipping_same_as_billing !== undefined ? { shipping_same_as_billing: input.patch.shipping_same_as_billing } : {}),
    ...(input.patch.notes !== undefined ? { notes: input.patch.notes ?? null } : {}),
    ...(input.patch.primary_payment_method !== undefined ? { primary_payment_method: input.patch.primary_payment_method ?? null } : {}),
    ...(input.patch.sales_form_delivery !== undefined ? { sales_form_delivery: input.patch.sales_form_delivery ?? null } : {}),
    ...(input.patch.invoice_language !== undefined ? { invoice_language: input.patch.invoice_language } : {}),
    ...(input.patch.credit_limit !== undefined ? { credit_limit: input.patch.credit_limit ?? null } : {}),
    ...(input.patch.customer_type !== undefined ? { customer_type: input.patch.customer_type ?? null } : {}),
    ...(input.patch.tax_exemption_details !== undefined ? { tax_exemption_details: input.patch.tax_exemption_details ?? null } : {}),
    ...(input.patch.opening_balance !== undefined ? { opening_balance: input.patch.opening_balance ?? null } : {}),
    ...(input.patch.opening_balance_as_of !== undefined ? { opening_balance_as_of: input.patch.opening_balance_as_of ?? null } : {}),
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
  return db.selectFrom('customers as c')
    .selectAll('c')
    .select(eb => eb
      .selectFrom('invoices as i')
      .select(({ fn }) => fn.coalesce(
        sql<string>`SUM(i.total - COALESCE((
          SELECT SUM(pa.applied_amount)
          FROM payment_applications pa
          LEFT JOIN payments p ON p.id = pa.payment_id
          LEFT JOIN credit_memos cm ON cm.id = pa.credit_memo_id
          WHERE pa.invoice_id = i.id
            AND (p.status = 'posted' OR cm.status IN ('posted','applied'))
        ), 0))`,
        sql.lit('0'),
      ).as('open_balance'))
      .whereRef('i.customer_id', '=', 'c.id')
      .where('i.deleted_at', 'is', null)
      .where('i.status', 'in', ['posted', 'paid'])
      .as('open_balance')
    )
    .where('c.business_id', '=', business_id)
    .where('c.deleted_at', 'is', null)
    .orderBy('c.name')
    .execute();
}

export async function getCustomer(db: Kysely<DB>, business_id: string, customer_id: string) {
  const c = await db.selectFrom('customers').selectAll()
    .where('id', '=', customer_id).where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!c) throw new NotFoundError('customer', customer_id);
  return c;
}
