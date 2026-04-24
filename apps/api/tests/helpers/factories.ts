// apps/api/tests/helpers/factories.ts
import { Kysely, sql } from 'kysely';
import type { DB, UserRole, AccountType } from '../../src/db/types.js';
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
