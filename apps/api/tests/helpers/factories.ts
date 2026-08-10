// apps/api/tests/helpers/factories.ts
import { Kysely, sql } from 'kysely';
import type { DB, UserRole, AccountType, PaymentMethod } from '../../src/db/types.js';
import { hashPassword } from '../../src/services/auth/passwordHasher.js';

export async function makeFirm(db: Kysely<DB>, name = 'Test Firm'): Promise<{ id: string; name: string }> {
  const row = await db.insertInto('firms').values({ name }).returningAll().executeTakeFirstOrThrow();
  return { id: row.id, name: row.name };
}

export async function makeBusiness(db: Kysely<DB>, firm_id: string, name = 'Test Business') {
  const row = await db.insertInto('businesses').values({ firm_id, name }).returningAll().executeTakeFirstOrThrow();
  return row;
}

export async function makeUser(
  db: Kysely<DB>,
  firm_id: string,
  opts: { email?: string; password?: string; role?: UserRole; full_name?: string } = {},
) {
  const {
    email = `user-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password = 'test-password-123',
    role = 'accountant',
    full_name = 'Test User',
  } = opts;
  const password_hash = await hashPassword(password);
  const row = await db.insertInto('users')
    .values({ firm_id, email, password_hash, full_name, role })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { ...row, plaintext_password: password };
}

export async function grantAccess(db: Kysely<DB>, user_id: string, business_id: string, role_override: UserRole | null = null) {
  return db.insertInto('user_business_access')
    .values({ user_id, business_id, role_override })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function makeAccount(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ code: string; name: string; account_type: AccountType; is_system: boolean }> = {},
) {
  const code = opts.code ?? `ACC${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
  return db.insertInto('chart_of_accounts').values({
    business_id,
    code,
    name: opts.name ?? `Account ${code}`,
    account_type: opts.account_type ?? 'asset',
    is_system: opts.is_system ?? false,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function seedCoa(db: Kysely<DB>, business_id: string) {
  await sql`SELECT seed_default_coa(${business_id}::uuid)`.execute(db);
}

export async function makePeriod(
  db: Kysely<DB>,
  business_id: string,
  starts_on: string,
  ends_on: string,
  status: 'open' | 'closed' = 'open',
) {
  return db.insertInto('fiscal_periods').values({
    business_id, starts_on, ends_on, status,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function seedYearPeriods(db: Kysely<DB>, business_id: string, year: number) {
  await sql`SELECT seed_calendar_year_periods(${business_id}::uuid, ${year}::int)`.execute(db);
}

export async function makeCustomer(db: Kysely<DB>, business_id: string, opts: Partial<{ name: string; email: string | null }> = {}) {
  return db.insertInto('customers').values({
    business_id,
    name: opts.name ?? `Customer ${Math.random().toString(36).slice(2, 8)}`,
    email: opts.email ?? null,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeTaxCode(
  db: Kysely<DB>, business_id: string, tax_payable_account_id: string,
  opts: Partial<{ code: string; name: string; rate: number }> = {},
) {
  const tc = await db.insertInto('tax_codes').values({
    business_id,
    code: opts.code ?? 'TAX',
    name: opts.name ?? 'Sales Tax',
    tax_payable_account_id,
  }).returningAll().executeTakeFirstOrThrow();
  await db.insertInto('tax_rates').values({
    tax_code_id: tc.id,
    rate: String(opts.rate ?? 0.0875),
    effective_from: '2000-01-01',
  }).execute();
  return tc;
}

export async function makeVendor(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ name: string; email: string | null; is_1099: boolean }> = {},
) {
  return db.insertInto('vendors').values({
    business_id,
    name: opts.name ?? `Vendor ${Math.random().toString(36).slice(2, 8)}`,
    email: opts.email ?? null,
    is_1099: opts.is_1099 ?? false,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeBankAccount(
  db: Kysely<DB>,
  business_id: string,
  cash_account_id: string,
  opts: Partial<{ name: string; institution: string; account_last_four: string }> = {},
) {
  return db.insertInto('bank_accounts').values({
    business_id,
    cash_account_id,
    name: opts.name ?? 'Checking',
    institution: opts.institution ?? null,
    account_last_four: opts.account_last_four ?? null,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeBankRule(
  db: Kysely<DB>,
  business_id: string,
  offset_account_id: string,
  opts: Partial<{
    name: string;
    description_contains: string;
    sign_filter: 'any' | 'inflow_only' | 'outflow_only';
    priority: number;
    min_amount: string | number | null;
    max_amount: string | number | null;
  }> = {},
) {
  return db.insertInto('bank_transaction_rules').values({
    business_id,
    offset_account_id,
    name: opts.name ?? 'Test Rule',
    description_contains: opts.description_contains ?? 'stripe',
    sign_filter: opts.sign_filter ?? 'any',
    ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
    ...(opts.min_amount !== undefined ? { min_amount: opts.min_amount } : {}),
    ...(opts.max_amount !== undefined ? { max_amount: opts.max_amount } : {}),
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeFixedAsset(
  db: Kysely<DB>,
  business_id: string,
  accounts: { asset: string; dep_expense: string; accumulated: string },
  opts: Partial<{ name: string; cost: string; salvage_value: string; useful_life_years: number; purchase_date: string }> = {},
) {
  return db.insertInto('fixed_assets').values({
    business_id,
    name: opts.name ?? 'Laptop',
    asset_account_id: accounts.asset,
    depreciation_expense_account_id: accounts.dep_expense,
    accumulated_depreciation_account_id: accounts.accumulated,
    purchase_date: opts.purchase_date ?? '2026-01-01',
    cost: opts.cost ?? '2400.00',
    salvage_value: opts.salvage_value ?? '0',
    useful_life_years: opts.useful_life_years ?? 2,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeExpenseTransaction(
  db: Kysely<DB>,
  business_id: string,
  expense_account_id: string,
  payment_account_id: string,
  opts: Partial<{ amount: string; payee_text: string; transaction_date: string; payment_method: PaymentMethod }> = {},
) {
  return db.insertInto('expense_transactions').values({
    business_id,
    expense_account_id,
    payment_account_id,
    payment_method: opts.payment_method ?? 'other',
    amount: opts.amount ?? '50.00',
    payee_text: opts.payee_text ?? 'Test Payee',
    transaction_date: opts.transaction_date ?? '2026-04-01',
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeRecurringTemplate(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ name: string; template_type: 'journal_entry'|'invoice'|'bill'; payload: unknown; recurrence: 'weekly'|'monthly'|'quarterly'|'yearly'; next_run_date: string }> = {},
) {
  return db.insertInto('recurring_templates').values({
    business_id,
    name: opts.name ?? 'Template',
    template_type: opts.template_type ?? 'journal_entry',
    payload: (opts.payload ?? {}) as object,
    recurrence: opts.recurrence ?? 'monthly',
    next_run_date: opts.next_run_date ?? '2026-04-01',
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeFile(
  db: Kysely<DB>,
  business_id: string,
  uploaded_by_user_id: string,
  opts: Partial<{ original_name: string; mime_type: string; byte_size: number; storage_path: string }> = {},
) {
  return db.insertInto('files').values({
    business_id,
    uploaded_by_user_id,
    original_name: opts.original_name ?? 'receipt.png',
    mime_type: opts.mime_type ?? 'image/png',
    byte_size: opts.byte_size ?? 1024,
    storage_path: opts.storage_path ?? `aa/bbccddeeff${Math.random().toString(36).slice(2)}.png`,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeIntegrationInboxRow(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ source: 'stripe_csv'|'paypal_csv'|'shopify_csv'|'generic'; description: string; amount: string; occurred_at: string }> = {},
) {
  return db.insertInto('integration_inbox').values({
    business_id,
    source: opts.source ?? 'stripe_csv',
    description: opts.description ?? 'Test row',
    amount: opts.amount ?? '10.00',
    occurred_at: opts.occurred_at ?? '2026-04-15',
    raw_payload: {} as object,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makePurchaseOrder(
  db: Kysely<DB>,
  business_id: string,
  vendor_id: string,
  opts: Partial<{ po_number: string; order_date: string }> = {},
) {
  return db.insertInto('purchase_orders').values({
    business_id,
    vendor_id,
    po_number: opts.po_number ?? `PO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    order_date: opts.order_date ?? '2026-04-01',
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeSalesOrder(
  db: Kysely<DB>,
  business_id: string,
  customer_id: string,
  opts: Partial<{ so_number: string; order_date: string }> = {},
) {
  return db.insertInto('sales_orders').values({
    business_id,
    customer_id,
    so_number: opts.so_number ?? `SO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    order_date: opts.order_date ?? '2026-04-01',
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeBudget(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ name: string; fiscal_year: number; status: 'draft'|'active'|'archived' }> = {},
) {
  return db.insertInto('budgets').values({
    business_id,
    name: opts.name ?? `Budget ${Math.random().toString(36).slice(2, 6)}`,
    fiscal_year: opts.fiscal_year ?? 2026,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeCustomReport(
  db: Kysely<DB>,
  business_id: string,
  owner_user_id: string,
  opts: Partial<{ name: string; definition: unknown }> = {},
) {
  return db.insertInto('custom_report_definitions').values({
    business_id,
    owner_user_id,
    name: opts.name ?? 'Test Report',
    definition: (opts.definition ?? {
      account_ids: [],
      date_range: { from: '2026-01-01', to: '2026-12-31' },
      group_by: 'account',
      columns: ['debit', 'credit', 'net'],
    }) as object,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeEmployee(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ full_name: string; hire_date: string }> = {},
) {
  return db.insertInto('employees').values({
    business_id,
    full_name: opts.full_name ?? `Employee ${Math.random().toString(36).slice(2, 6)}`,
    hire_date: opts.hire_date ?? '2026-01-01',
  }).returningAll().executeTakeFirstOrThrow();
}
